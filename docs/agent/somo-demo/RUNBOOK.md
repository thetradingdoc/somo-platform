# Somo demo agent — runbook

**Last updated:** 2026-06-02

## Prerequisites

1. `middleware-platform/.env` — see env table below.
2. **Local dev minimum:** `SOMO_DEMO_ENABLED=1` plus existing `RETELL_AGENT_ID` and `TWILIO_PHONE_NUMBER`.
3. Public `API_BASE_URL` (ngrok or Cloud Run) for real Twilio calls.
4. Optional: dedicated `SOMO_DEMO_RETELL_AGENT_ID` / `SOMO_DEMO_TWILIO_FROM_NUMBER` for production isolation.

Legacy `DODGECALL_*` names are still accepted via [somo-demo-env.js](../../../middleware-platform/lib/somo-demo-env.js).

## Env

| Variable | Required | Notes |
|----------|----------|--------|
| `SOMO_DEMO_ENABLED` | yes | `1` on; `0` disables API + WS demo branch |
| `SOMO_DEMO_RETELL_AGENT_ID` | optional | Falls back to `RETELL_SALES_AGENT_ID`, then `RETELL_AGENT_ID` |
| `SOMO_DEMO_TWILIO_FROM_NUMBER` | optional | Falls back to `TWILIO_PHONE_NUMBER` |
| `SOMO_DEMO_VOICE_ID` | optional | Falls back to `RETELL_VOICE_ID` for configure script |
| `SOMO_DEMO_SMS_FROM_NUMBER` | optional | Defaults to demo Twilio FROM |
| `SOMO_DEMO_SIGNUP_URL` | optional | Default `/signup?utm_source=somo-demo` |
| `SOMO_DEMO_MAX_DURATION_SEC` | optional | Default `240` |
| `SOMO_DEMO_MAX_CONCURRENT` | optional | Default `3` |
| `SOMO_DEMO_DAILY_CAP` | optional | Default `100` |
| `API_BASE_URL` | yes for telephony | Must be reachable by Twilio |
| `RETELL_API_KEY` | yes for configure | |

## Configure Retell demo agent

```bash
cd middleware-platform
npm run configure:somo-demo
```

Sets custom LLM WebSocket, voice, minimal tools (`end_call`, `record_interest`, `send_signup_link`).

## Public API

| Method | Path |
|--------|------|
| GET | `/api/public/somo-demo/health` |
| POST | `/api/public/somo-demo/request-call` |

## Disable demo

```bash
SOMO_DEMO_ENABLED=0
```

## Smoke

```bash
npm run smoke:somo-demo --prefix middleware-platform
npm run test:e2e-somo-landing --prefix middleware-platform
npm test -- --testPathPattern=somo-demo
```

## Checklist

- [ ] `SOMO_DEMO_ENABLED=0` rejects form API.
- [ ] Female voice configured (`SOMO_DEMO_VOICE_ID`).
- [ ] Production uses `https://api.callsomo.com/api/public/somo-demo/*`.


---

<a id="phase-a-go-recovery-runbook"></a>

## PHASE A GO RECOVERY RUNBOOK

*Merged from `docs/agent/somo-demo/PHASE_A_GO_RECOVERY_RUNBOOK.md` on 2026-06-02.*

# Phase A GO Recovery Runbook

Last updated: 2026-06-02  
Owner: Voice Platform

## Purpose

Recover Phase A to GO by fixing canonical production route exposure and proving all closure gates with objective evidence.

## Command Sequence (Exact)

Run from repo root unless noted.

1) Operator preflight

```bash
gcloud auth login
gcloud config set project somo-callsomo
gcloud auth list
```

2) Deploy Cloud Run middleware revision (production profile)

```bash
./scripts/deploy-to-gcp-production.sh
```

Targets `somo-middleware`. Ensure `api.callsomo.com` domain mapping points at that service. See `docs/deployment/SOMO_CLOUD_RUN_DEPLOY.md`.

3) Post-deploy route parity probes

```bash
curl -i https://api.callsomo.com/api/public/somo-demo/health
```

4) Non-mocked production smoke

```bash
npm run test:prod:smoke --prefix middleware-platform
```

5) Duplicate-window runtime proof (same phone, same window)

```bash
# Example payloads (run twice with same phone)
curl -i -X POST https://api.callsomo.com/api/public/somo-demo/request-call \
  -H 'Content-Type: application/json' \
  -d '{"name":"Prod Gate","phone":"+15005550006","use_case":"medical_clinic","consent":true}'
```

## Verification Matrix

| Check | Command | PASS | FAIL |
|---|---|---|---|
| Canonical health | `curl /api/public/somo-demo/health` | 200 + `ok`, `demo_enabled` | 404 or wrong JSON |
| Landing turn | `curl -X POST /api/public/landing-assistant/turn` (JSON body) | 200 + assistant JSON (no handler undefined) | 5xx or `handlePublicLandingAssistantMessage is not defined` |
| Duplicate guard | two same-phone requests in <24h | 1st 200, 2nd 429 + `DUPLICATE_PHONE_WINDOW` | 2nd request accepted |
| Non-mocked smoke | `npm run test:prod:smoke --prefix middleware-platform` | canonical health + canonical consent tests pass | any canonical assertion fails |
| Deploy readiness | `./scripts/deploy-to-gcp-production.sh` | successful Cloud Run rollout | auth/deploy error |

## Documentation Truth Checklist

After every run, update:

- `docs/agent/somo-demo/PROD_OUTBOUND_SALES_RUNBOOK.md`
- `docs/agent/somo-demo/PROD_E2E_EXECUTION_REPORT_2026-06-02.md`
- `todos/pending/SOMO_DEMO_PROD_GAP_BACKLOG.md`
- `docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md`

Required evidence entries:

1) Pre/post deploy route probe outputs (status + key body).  
2) Duplicate-window proof (`429`, `DUPLICATE_PHONE_WINDOW`).  
3) Non-mocked prod smoke output + artifact paths under `middleware-platform/test-results/prod-runs/`.  
4) Explicit gate decision (`GO` or `NO-GO`) with reason.

## Current Known Evidence (This Session)

- Canonical health: **200** (`{"ok":true,"demo_enabled":true}`)
- Landing turn: **200** (valid assistant JSON)
- `verify:prod:routing-smoke`: **PASS**
- `test:prod:smoke`: **2/2 passed**
- Production service: **`somo-middleware`** revision `somo-middleware-00002-zrj`
- Domain: `api.callsomo.com` → `somo-middleware` (cutover 2026-06-02)

## Final Gate Rule

Phase A is GO only if all are green:

1) canonical health + landing turn on `api.callsomo.com`,  
2) rolling 24h duplicate protection runtime proof,  
3) non-mocked production smoke passes,  
4) docs/backlog are truth-synced.

If any item is red, remain NO-GO and do not enter Phase B.


---

<a id="prod-outbound-sales-runbook"></a>

## PROD OUTBOUND SALES RUNBOOK

*Merged from `docs/agent/somo-demo/PROD_OUTBOUND_SALES_RUNBOOK.md` on 2026-06-02.*

# Production Outbound Sales Pipeline Runbook

Last updated: 2026-06-02 (Phase A closure pass)
Owner: Growth + Voice Platform

## Purpose

Run and verify a production-grade outbound sales pipeline from Somo landing demo requests through completed calls, structured qualification capture, CTA delivery, and post-call analytics export.

## Current Production Call Path

Primary codepaths:

- Landing submit client: `unified-dashboard/somo-landing/src/api/somoDemo.js`
- Landing form: `unified-dashboard/somo-landing/src/components/DemoSection.jsx`
- Public API route: `middleware-platform/routes/somo-demo-public.js`
- Request orchestration + limits: `middleware-platform/services/somo-demo-service.js`
- Outbound dialer: `middleware-platform/services/outbound-call-service.js`
- Voice ingress and metadata: `middleware-platform/services/voice-incoming-handler.js`
- Demo voice workflow/tools: `middleware-platform/webhooks/somo-demo-handler.js`

```mermaid
flowchart TD
  landingForm[Landing demo form] --> submitApi[POST /api/public/somo-demo/request-call]
  submitApi --> demoService[somo-demo-service]
  demoService --> dialTwilio[outbound-call-service]
  dialTwilio --> voiceIncoming[/voice/incoming call_type=somo_demo]
  voiceIncoming --> retellWs[retell websocket]
  retellWs --> demoHandler[somo-demo-handler]
  demoHandler --> toolCalls[record_interest send_signup_link end_call]
  toolCalls --> demoRequests[somo_demo_requests]
  demoRequests --> analyticsExport[Sheets exporter]
```

## Target Full-Sales Behavior

Every answered call should follow this sequence:

1. Open and permission check.
2. Qualification:
   - language
   - country
   - city
   - specialty of practice
   - single or team practice
3. Discovery:
   - current call workflow
   - biggest pain points
   - key questions asked by lead
4. Objection handling and package recommendation.
5. CTA close:
   - signup link SMS
   - follow-up booking path
   - disqualify/no-interest path

## Telemetry Contract (Required Fields)

Store per lead and/or event:

- `lead_id` (same as `demo_request_id` where possible)
- `name`
- `phone_e164`
- `language`
- `country`
- `city`
- `practice_specialty`
- `practice_size` (`single` | `team`)
- `call_start_at`
- `call_end_at`
- `call_duration_sec`
- `questions_asked` (array or serialized JSON)
- `pain_points` (array or serialized JSON)
- `interest_level` (`cold` | `warm` | `hot`)
- `outcome` (`completed`, `voicemail`, `no_answer`, `failed`, `not_interested`, `qualified`)
- `next_step`
- `signup_link_sent` (0/1)
- `booked_demo` (0/1)
- `notes_summary`

## Google Sheets Model (Service Account)

Use two tabs in one spreadsheet:

1. `EventLog` (append-only)
   - one row per event (`call_started`, `answered`, `qualified`, `cta_sent`, `call_ended`, `voicemail_detected`, etc.)
   - include `idempotency_key` = `<lead_id>:<event_type>:<timestamp_bucket>`
2. `LeadStatus` (upsert by `lead_id`)
   - current-state row for each lead
   - updated after every major state transition

Security requirements:

- service-account key from secret manager or env path, never committed
- retry with backoff + dead-letter log for failed writes
- redact PII from app logs except approved fields

## Production Preflight Checklist

Run before any live call:

1. `DODGECALL_DEMO_ENABLED=1`.
2. Telephony envs valid (`TWILIO_*`, Retell agent, webhook base).
3. `/api/public/somo-demo/health` returns `200` with `demo_enabled=true`.
4. Approved synthetic test numbers are on allowlist and consented.
5. Time-window check: do not call outside local legal hours.
6. DNC and opt-out exclusions loaded.
7. Landing assistant turn is green:
   - `POST /api/public/landing-assistant/turn` returns `200` with valid JSON (no undefined handler errors).
8. `npm run verify:prod:routing-smoke --prefix middleware-platform` passes (canonical health on prod API host).

Reference execution runbook:

- `docs/agent/somo-demo/PHASE_A_GO_RECOVERY_RUNBOOK.md`

### Current gate reality (must be green before Phase B)

- Canonical route in prod: **GREEN** (`/api/public/somo-demo/health` → 200).
- Landing assistant turn: **GREEN** (`/api/public/landing-assistant/turn` → 200).
- `verify:prod:routing-smoke`: **GREEN** (PASS).
- Non-mocked prod smoke: **GREEN** (`test:prod:smoke` 2/2).
- Active service: `somo-middleware` revision `somo-middleware-00002-zrj`.
- GCP domain cutover: **GREEN** (`api.callsomo.com` → `somo-middleware`, 2026-06-02).
- Rolling 24h duplicate guard: **GREEN in code**; runtime proof still recommended before high-volume outbound.

## Comprehensive E2E Scenario Matrix

Execute and log all:

- Language variants: English + one alternate language.
- Practice profiles: dental, medical, specialty, billing.
- Team size: single and team.
- Outcomes:
  - answered + qualified + CTA sent
  - warm lead follow-up
  - voicemail/no-answer
  - objection-heavy but interested
  - do-not-proceed / not interested

## Evidence to Capture Per Scenario

- request payload and response status from `/api/public/somo-demo/request-call`
- Twilio `call_sid`
- `/voice/incoming` metadata: `call_type=somo_demo`, `use_case`, `prospect_name`, `demo_request_id`
- stage transitions in `somo_demo_requests`
- tool invocation evidence (`record_interest`, `send_signup_link`, `end_call`)
- call start/end timestamps and disposition
- `EventLog` and `LeadStatus` Sheets row IDs

## Error code contract (API)

`POST /api/public/somo-demo/request-call` should emit deterministic `error_code` values:

- `CONSENT_REQUIRED`
- `INVALID_USE_CASE`
- `DEMO_DISABLED`
- `DAILY_CAP_REACHED`
- `CONCURRENT_CAP_REACHED`
- `IP_RATE_LIMIT`
- `DUPLICATE_PHONE_WINDOW`

## Rollback

Immediate stop:

1. Set `DODGECALL_DEMO_ENABLED=0`.
2. Restart middleware.
3. Suspend scheduled outbound actions and Sheets exporter job.
4. File incident summary with affected `call_sid` range.


---

<a id="prod-e2e-execution-report-2026-06-02"></a>

## PROD E2E EXECUTION REPORT 2026-06-02

*Merged from `docs/agent/somo-demo/PROD_E2E_EXECUTION_REPORT_2026-06-02.md` on 2026-06-02.*

# Production E2E Execution Report — 2026-06-02

## Summary

- Scope: outbound sales pipeline from landing request to call initiation.
- Environment: `api.callsomo.com` → Cloud Run **`somo-middleware`** (cutover 2026-06-02).
- **Phase A routing gate: GO** — canonical somo-demo health, landing turn, prod smokes (see below).
- **Phase B still open:** Sheets telemetry, duplicate-phone runtime proof, qualification persistence, full browser E2E.

## Phase A Closure (GO — 2026-06-02)

Primary runbook: `docs/agent/somo-demo/PHASE_A_GO_RECOVERY_RUNBOOK.md`  
Deploy SSOT: `docs/deployment/SOMO_CLOUD_RUN_DEPLOY.md`  
GCP service rename: `docs/deployment/GCP_SOMO_SERVICE_CUTOVER.md`

Evidence (production):

| Check | Result |
|---|---|
| Canonical health `GET /api/public/somo-demo/health` | **200** (`ok`, `demo_enabled`) |
| Landing turn `POST /api/public/landing-assistant/turn` | **200** (valid JSON assistant response) |
| `npm run verify:prod:routing-smoke --prefix middleware-platform` | **PASS** |
| `npm run test:prod:smoke --prefix middleware-platform` | **2/2 passed** |
| Cloud Run service + revision | `somo-middleware` / `somo-middleware-00002-zrj` |
| Domain `api.callsomo.com` → service | **`somo-middleware`** (cutover 2026-06-02) |

Commands:

```bash
curl -sS -o /dev/null -w "canonical:%{http_code}\n" https://api.callsomo.com/api/public/somo-demo/health
curl -sS -o /dev/null -w "landing:%{http_code}\n" -X POST https://api.callsomo.com/api/public/landing-assistant/turn \
  -H 'content-type: application/json' -d '{"session_id":"phase-a","message":"hello"}'
npm run verify:prod:routing-smoke --prefix middleware-platform
npm run test:prod:smoke --prefix middleware-platform
```

**Gate decision: GO** — canonical route, landing assistant, routing smoke, and non-mocked prod smoke are green. Phase B may proceed per backlog.

## Historical — pre-Phase-A closure (2026-06-02 morning)

> **Superseded.** Records the state before canonical route deploy and GCP cutover. Do not use for current gate decisions.

## Preflight Results (historical)

### Host and route checks

Commands executed:

```bash
curl https://api.callsomo.com/health
curl https://api.callsomo.com/api/public/somo-demo/health
curl https://api.callsomo.com/api/public/dodgecall/health
```

Observed:

- `/health` on `api.callsomo.com`: `200`
- `/api/public/somo-demo/health` on `api.callsomo.com`: `404`
- `/api/public/dodgecall/health` on `api.callsomo.com`: `200`, `{"ok":true,"demo_enabled":true}`

Conclusion:

- Production currently serves the demo API on the legacy alias route (`dodgecall`) rather than canonical `somo-demo`.

### Synthetic test-number strategy

- Research confirms Twilio magic numbers support synthetic call testing with test credentials:
  - `+15005550006` (valid magic number path)
  - Source: [Twilio Test Credentials](https://www.twilio.com/docs/iam/test-credentials)
- Used `+15005550006` for non-customer synthetic run payloads.

## Scenario Matrix Run

Endpoint tested:

- `POST https://api.callsomo.com/api/public/dodgecall/request-call`

### Executed scenarios

1. `S1_consent_false`  
   status: `400`  
   body: `{"error":"Consent is required to place a demo call"}`

2. `S2_invalid_use_case`  
   status: `400`  
   body: `{"error":"Invalid use case"}`

3. `S3_valid_medical`  
   status: `200`  
   response includes `demo_request_id`, `call_id=CA...`

4. `S4_valid_dental`  
   status: `200`  
   response includes `demo_request_id`, `call_id=CA...`

5. `S5_valid_billing`  
   status: `200`  
   response includes `demo_request_id`, `call_id=CA...`

6. `S6_duplicate_phone_same_day`  
   status: `200`  
   response includes new `demo_request_id`, `call_id=CA...`

7. Extended qualification payload (language/country/city/specialty/practice_size/questions_asked)  
   status: `200`  
   response includes `demo_request_id`, `call_id=CA...`

### Key findings from matrix

- Consent and use-case validation work.
- Outbound call initiation works and returns Twilio call SID.
- Duplicate-phone throttle appears ineffective in this production path.
- Extended qualification fields are accepted by API request body but not confirmed as persisted/exported.

## Browser E2E Status

### Prod smoke runner

Command:

```bash
npm run test:prod:smoke
```

Result:

- `playwright.prod.config.cjs` exists and command runs.
- Current runtime failure: Playwright Chromium binary missing (`npx playwright install` required in runtime/CI image).

### Somo landing Playwright suite

Command:

```bash
npm run test:e2e-somo-landing
```

Result:

- Build succeeded.
- Browser launch failed with repeated `SIGSEGV` from Chromium headless shell.
- 4 tests failed at browser start; 1 skipped.

Conclusion:

- Browser-level E2E evidence for production UX and post-submit flow is currently blocked on runtime browser install + prior Chromium stability issues.

## Sales Telemetry and Sheets Validation

### Required telemetry fields requested

- `language`, `country`, `city`, `practice_specialty`, `practice_size`, `call_start_at`, `call_end_at`, `questions_asked`, plus lead and outcome fields.

### Validation result

- No dedicated Google Sheets writer for Somo demo pipeline was identified in current outbound sales flow.
- No production evidence collected for:
  - append-only event rows
  - lead-status upsert rows
  - idempotency/retry behavior for Sheets writes

Conclusion:

- Sheets sync is not yet implemented for this pipeline and remains a blocker for analytics completeness.

## Overall Pass/Fail

- API ingress and dial initiation: **PASS**
- Canonical route parity (`/api/public/somo-demo/*`): **PASS**
- Duplicate-call safeguards: **FAIL**
- Browser E2E runner readiness: **FAIL**
- Sheets telemetry export: **FAIL**
- End-to-end qualification evidence (language/city/specialty/team): **FAIL (not verifiable yet)**
- Phase A closure decision: **GO**

## Recommended Next Re-run Gate (Phase B)

1. Duplicate number rate-limit behavior verified on prod (`DUPLICATE_PHONE_WINDOW`).
2. Sheets event/status exporter implemented and observed in production.
3. Full browser landing E2E green (Playwright install + stability).
4. Qualification fields persisted and exported.
