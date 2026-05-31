# Staging diagnostic runbook (Playwright + live Twilio)

**Last updated:** 2026-05-30  
**Hosts:** UI `https://myskinandcare.com` · API `https://api.myskinandcare.com`  
**SSOT deploy:** [STAGING_MYSKINANDCARE.md](../deployment/STAGING_MYSKINANDCARE.md)

This runbook implements the four-pillar staging audit: **signup**, **Twilio provisioning**, **agent**, **inbound calls**. Each step has a step ID for pass/fail tracking and a primary failure hypothesis.

---

## Required operator setup

| Variable | Purpose |
|----------|---------|
| `STAGING_DB_PATH` | Local copy of staging SQLite (GCS download or Cloud SQL export) — email OTP + post-run asserts |
| `STAGING_EMAIL_CODE` | **Required for S2–S7** browser signup (inbox); GCS snapshot often lags live API |
| `POSTGRES_URL` | Optional: read `email_verification_codes` from live Cloud SQL (see `staging-email-code-pg.cjs`) |
| `TRIAL_E2E_PHONE` | Handset that receives **real** Twilio Verify SMS on staging |
| `STAGING_SMS_CODE` | Latest SMS code (set before phone step / `staging:trial-provision`) |
| `SOMO_OWNER_EMAIL` / `SOMO_OWNER_PASSWORD` | Owner login for voice-agent tests (GCP secret locally) |
| `API_BASE_URL` | `https://api.myskinandcare.com` for API smokes |
| `RETELL_API_KEY` / `RETELL_LLM_WEBSOCKET_URL` | Cloud Run — agent create + Kelly WS (`wss://api.myskinandcare.com/webhook/retell/llm`) |

Download staging DB (example):

```bash
cd middleware-platform
GCS_DB_BUCKET=somo-staging-db GCS_DB_OBJECT=middleware-staging.db \
  node scripts/cloudrun-db-sync.cjs download
export STAGING_DB_PATH=/var/data/middleware-staging.db   # or path printed by script
```

---

## Execution order

```text
Phase 0 preflight → live trial provision smoke → Playwright signup → Playwright voice agent
→ manual inbound call → staging:call-verify
```

Estimated time: 45–90 minutes (SMS + one PSTN call).

---

## Phase 0 — Preflight (P0)

```bash
cd middleware-platform
STAGING_DB_PATH=./path/to/middleware-staging.db npm run staging:preflight
npm run test:e2e:staging          # shallow smoke
```

Manifest: `middleware-platform/test-results/staging-preflight.json` (gitignored).

| Step ID | Pass when |
|---------|-----------|
| P0-1 | `staging:preflight` exit 0 |
| P0-2 | `test:e2e:staging` 4 tests green |
| P0-3 | Manifest lists `owner_customer_id` when `STAGING_DB_PATH` set |

---

## Phase 1 — Signup journey (S1–S8)

```bash
export TRIAL_E2E_PHONE=+1XXXXXXXXXX
export STAGING_DB_PATH=...
export STAGING_EMAIL_CODE=123456   # from inbox after S3 signup POST
# Or live DB (no GCS lag):
# export POSTGRES_URL=postgresql://...
# After SMS arrives:
export STAGING_SMS_CODE=123456
npm run test:e2e:staging-signup --prefix middleware-platform
# API-only trial path (same codes):
npm run test:e2e:staging-signup-api --prefix middleware-platform
```

| Step ID | What it tests |
|---------|----------------|
| S1 | Persona step + Somo branding |
| S2–S7 | Full wizard → trial activation → DB assert |
| S8 | Duplicate phone → 409 on `verify-phone/send` |

### Signup failure matrix

| Symptom | Step | Likely root cause |
|---------|------|-------------------|
| `POST /api/signup` 4xx/5xx | S3 | Validation, rate limit, API down |
| Email verify fails | S4 | Email service; code expired; wrong `STAGING_DB_PATH` |
| Phone verify 404 | S5 | `TWILIO_VERIFY_SERVICE_SID` wrong on Cloud Run |
| No dedicated line after SMS | S5 | `TRIAL_SIM_FLOW_ENABLED=0`; Twilio purchase failed |
| UI stuck on step | S2–S7 | [PROVIDER_SIGNUP_FLOW.md](../deployment/PROVIDER_SIGNUP_FLOW.md) redirect vs API `trial_sim_flow` |
| Session missing Twilio number | S7 | Provision error; check middleware logs |

---

## Phase 2 — Live Twilio provisioning (T1–T4)

```bash
cd middleware-platform
API_BASE_URL=https://api.myskinandcare.com \
STAGING_DB_PATH=... \
TRIAL_E2E_PHONE=+1... \
STAGING_SMS_CODE=... \
npm run staging:trial-provision
```

| Step ID | Check |
|---------|--------|
| T1 | Twilio console: voice URL `https://api.myskinandcare.com/voice/incoming?customer_id={CUSTOMER_ID}` |
| T2 | `customers.twilio_phone_sid` matches Twilio Phone SID |
| T3 | Webhook not pointing at ngrok/local |
| T4 | `node scripts/audit-voice-twilio-numbers.cjs` — no orphans |

```bash
STAGING_DB_PATH=... npm run staging:db-assert -- --email=trial-smoke-...@doclittle.test
```

### Provisioning failure matrix

| Symptom | Likely root cause |
|---------|-------------------|
| API OK, no number in DB | Twilio error swallowed — Cloud Run logs |
| Number in DB, wrong webhook | Bootstrap / attach script used wrong `customer_id` |
| Verify OK, no purchase | Twilio limits, `TRIAL_DEFAULT_AREA_CODE`, billing |

---

## Phase 3 — Agent (A1–A5)

```bash
export SOMO_OWNER_EMAIL=...
export SOMO_OWNER_PASSWORD=...
npm run test:e2e:staging-voice --prefix middleware-platform
```

Uses **real** `/api/voice-agent/settings` and `/api/kelly/*` (no Playwright mocks).

| Step ID | Pass when |
|---------|-----------|
| A1 | `#vaPhone` shows owner/trial `+1…` |
| A2–A3 | Voice-setup wizard saves greeting; GET settings returns it |
| A4 | Kelly status endpoint 200 |
| A5 | DB `retell_agent_id` present (when `STAGING_DB_PATH` set) |

Optional Retell check:

```bash
API_BASE_URL=https://api.myskinandcare.com node configure-retell.js
```

Dashboard: agent WS = `wss://api.myskinandcare.com/webhook/retell/llm`

### Agent failure matrix

| Symptom | Likely root cause |
|---------|-------------------|
| Empty `#vaPhone` | Trial not provisioned or wrong session |
| Save greeting 401 | `customer_session` / cookie domain |
| Wrong voice on call | `retell_agent_id` mismatch |
| Greeting not spoken | Retell prompt not synced (W3-02–03) |

---

## Phase 4 — Calls (C1–C4)

### C1 — HTTP billing gate (no PSTN)

```bash
# Confirm TWILIO_WEBHOOK_SIGNATURE_REQUIRED on staging first
node scripts/test-voice-incoming-gate.cjs --base=https://api.myskinandcare.com
```

### C2 — Manual inbound call (operator)

1. Call the tenant DID from `TRIAL_E2E_PHONE`.
2. Expect answer + Kelly (not instant hangup / not trial-paused only).

### C3 — DB verify

```bash
STAGING_DB_PATH=... npm run staging:call-verify -- --customer-id=<uuid>
```

Pass: `voice_call_log.customer_id` = trial customer (not owner default).

### C4 — Landing demo (optional)

`POST /api/public/dodgecall/request-call` — see [somo-landing E2E](../../middleware-platform/e2e/somo-landing.spec.cjs); separate from tenant inbound.

### Call failure matrix

| Symptom | Likely root cause |
|---------|-------------------|
| Rings, silent | Retell WS / `RETELL_API_KEY` / LLM websocket |
| Wrong tenant in log | Twilio voice URL missing `customer_id` |
| Trial paused TwiML only | `trial_status` expired or Kelly paused |
| No `voice_call_log` row | Webhook 403 signature; wrong public URL |

---

## Full npm matrix

| Command | Project |
|---------|---------|
| `npm run staging:preflight` | Phase 0 |
| `npm run test:e2e:staging` | `staging-smoke` |
| `npm run test:e2e:staging-signup` | `staging-signup` |
| `npm run test:e2e:staging-voice` | `staging-voice` |
| `npm run test:e2e:staging-full` | All staging projects |
| `npm run staging:trial-provision` | Live API Twilio smoke |
| `npm run staging:db-assert` | DB trial fields |
| `npm run staging:call-verify` | Post-call `voice_call_log` |

Trace on failure: `PW_TRACE=1 npm run test:e2e:staging-signup`

---

## Evidence package

Store under `middleware-platform/test-results/staging-run-YYYYMMDD/`:

- Playwright HTML report (`test-results/staging-playwright-report`)
- `staging-preflight.json`
- Cloud Run log slice (`customer_id`, `voice/incoming`, `retell`)
- Twilio debugger Call SID
- `staging:db-assert` JSON stdout

---

## Related

- [STAGING_SIGNOFF.md](../deployment/STAGING_SIGNOFF.md)
- [STAGING_TRIAL_ROLLOUT.md](../deployment/STAGING_TRIAL_ROLLOUT.md)
- [voice-inbound-troubleshooting.md](../runbooks/voice-inbound-troubleshooting.md)
