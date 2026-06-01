# Somo foundation runbook (Week 1)

> **Last reviewed:** 2026-05-29  
> **Gate:** Do not start Week 2 until Day 5 checks **V-01, V-02, V-03, V-07, V-08** and `npm run test:e2e:login` pass.

Reference: [ENV_AND_DB_SSOT.md](./ENV_AND_DB_SSOT.md) · [Verification matrix](#verification-matrix)

---

## Day 1 — Lock the environment

| ID | Step | Done when |
|----|------|-----------|
| D1-01 | Read [ENV_AND_DB_SSOT.md](./ENV_AND_DB_SSOT.md); set `DB_PATH=./middleware-dev.db` | Team agrees on one DB file |
| D1-02 | `cd middleware-platform && npm start` | Log shows `📁 Database path: …middleware-dev.db` |
| D1-03 | `mkdir -p backups && cp middleware-dev.db backups/middleware-dev-$(date +%Y%m%d).db` | Timestamped backup exists |
| D1-04 | Audit `.env` against env checklist in ENV doc | All voice vars documented |
| D1-05 | Copy `.env.example` → `.env`; fill secrets | New dev can boot without silent failures |
| D1-06 | `curl -s -o /dev/null -w '%{http_code}' http://localhost:5180/login` | `200` (somo-landing proxy → :4000) |

---

## Day 2 — Clean DB + owner account

| ID | Step | Done when |
|----|------|-----------|
| D2-01 | `npm run db:purge-test-tenants` (or fresh DB) | ≤1 real tenant target |
| D2-02 | Fill `SOMO_OWNER_*` + `local/provider-login.credentials` | Gitignored creds present |
| D2-03 | `npm run ensure:somo-owner` | Exit 0 |
| D2-04 | Run owner SQL census (see [TENANT_MODEL.md](./TENANT_MODEL.md)) | IDs written in handoff |
| D2-05 | If no `merchant_id`: script creates full tenant via `create-web-provider-account` | merchant + clinic + customer linked |
| D2-06 | Open `http://localhost:4000/login` | **V-01** dashboard loads |
| D2-07 | If prod exists: [prod-preflight-census.md](../runbooks/prod-preflight-census.md) read-only | Counts documented, no prod writes |

---

## Day 3 — Twilio bind

| ID | Step | Done when |
|----|------|-----------|
| D3-01 | Script exists: `scripts/attach-existing-twilio-number.cjs` | Runs locally |
| D3-02 | Twilio console: copy Phone SID for inbound line | SID recorded |
| D3-03 | `node scripts/attach-existing-twilio-number.cjs --customer-id=… --phone=+1… --twilio-sid=PN…` | DB columns set |
| D3-04 | Set contact phone + `phone_verified=1` if ≠ inbound | Documented in handoff |
| D3-05 | Set `NGROK_URL` or public `API_BASE_URL`; restart middleware | URL reachable from internet |
| D3-06 | Twilio voice URL: `{PUBLIC}/voice/incoming?customer_id={OWNER_ID}` | Saved in Twilio |
| D3-07 | Deploy akin-dunbar guards in settings + Retell WS | Owner never hits default shop |

**Staging DB vs Twilio:** If a GCS SQLite export shows empty `twilio_phone_number` / `twilio_phone_sid` for the owner but Twilio console lists an active inbound line, **trust Twilio + live API session** (and `npm run staging:call-verify`) over the snapshot. Attach/bind via `attach-existing-twilio-number.cjs` against the live DB path Cloud Run uses, not a stale local copy.

| D3-08 | Upsert `voice_agent_settings` on real `merchant_id` | GET `/api/voice-agent/settings` = owner |
| D3-09 | Change greeting in UI | Row updates owner `merchant_id` — **V-07** |

### Attach script usage

```bash
cd middleware-platform
node scripts/attach-existing-twilio-number.cjs \
  --customer-id=<OWNER_CUSTOMER_ID> \
  --phone=+18622307479 \
  --twilio-sid=PNxxxxxxxx \
  --update-webhook \
  --dry-run   # optional preview
```

---

## Day 4 — Retell + inbound path

| ID | Step | Done when |
|----|------|-----------|
| D4-01 | `customers.retell_agent_id` populated | ID in DB |
| D4-02 | Retell dashboard: agent webhook → middleware public URL | Matches env |
| D4-03 | `RETELL_API_KEY` (+ `RETELL_WEBHOOK_SECRET`) at boot | Checklist green |
| D4-04 | Inbound test call to Somo line | Call answers |
| D4-05 | Logs: `customer_id` = owner | **V-02** |
| D4-06 | `voice_call_log` row with owner `customer_id` | **V-03** |
| D4-07 | If silent: [voice-inbound-troubleshooting.md](../runbooks/voice-inbound-troubleshooting.md) | Checklist followed |

---

## Day 5 — Gate

| ID | Check |
|----|--------|
| G-01 | **V-01** Owner login |
| G-02 | **V-02** Inbound → owner `customer_id` |
| G-03 | **V-03** `voice_call_log` agrees |
| G-04 | **V-08** Landing demo call completes |
| G-05 | **V-07** No silent akin-dunbar for owner |
| G-06 | `npm run test:e2e:login` |
| G-07 | Fill [WEEK1_HANDOFF_TEMPLATE.md](./WEEK1_HANDOFF_TEMPLATE.md) |

---

## Verification matrix

| ID | Check | Depends on |
|----|--------|------------|
| V-01 | Owner `/login` | D2-06 |
| V-02 | Inbound → owner `customer_id` | D3-03–06, D4-04–05 |
| V-03 | `voice_call_log.customer_id` | D4-06 |
| V-07 | No akin-dunbar for owner | D3-07–09 |
| V-08 | Landing demo call | D1-06, middleware up |
| V-04 | Greeting = Retell behavior | Week 3 (W3-02–03) |
| V-05 | Kelly pause/resume sync | Week 2 (W2-07) |
| V-06 | `test:e2e:login` + voice specs | D2-01, clean DB |

---

## Deferred epics

- International phone (former W4-03)
- Admin role column (P1-09)
- Postgres DLQ monitoring (P1-06)
