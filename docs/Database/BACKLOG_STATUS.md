# Somo foundation backlog status

> **Last updated:** 2026-05-29  
> **Gate:** `npm run gate:week1` after operator Twilio/Retell + one inbound call.

Legend: **Done** = shipped in repo · **Operator** = you run once with credentials · **Deferred** = out of scope

---

## Week 1 — Foundation

| ID | Item | Status |
|----|------|--------|
| D1-01 | DB SSoT doc (`ENV_AND_DB_SSOT.md`, `local/README.md`) | Done |
| D1-02 | Startup log matches DB path | Done (gate checks path) |
| D1-03 | Backup dev DB before wipe | Operator |
| D1-04 | Voice env audit | Done (`npm run verify:voice-env`) |
| D1-05 | `.env.example` voice vars | Done |
| D1-06 | Login proxy `:5180/login` → 200 | Done (gate checks) |
| D2-01 | Purge test tenants | Done (`npm run db:purge-test-tenants`) |
| D2-02 | Owner credentials in env/local | Operator |
| D2-03 | `npm run ensure:somo-owner` | Done |
| D2-04 | Owner SQL census | Done (gate + `db:tenant-audit`) |
| D2-05 | Link merchant + clinic | Done (`saas-tenant-provision`, link script) |
| D2-06 | Owner login loads dashboard | Operator (V-01) |
| D2-07 | Prod preflight census read-only | Operator |
| D3-01 | Attach Twilio script | Done |
| D3-02 | Twilio console Phone SID | Operator |
| D3-03 | Run attach script | Operator |
| D3-04 | Contact phone + verified | Operator |
| D3-05 | Public `NGROK_URL` / `API_BASE_URL` | Operator |
| D3-06 | Twilio voice URL with `customer_id` | Operator |
| D3-07 | Akin-dunbar guards | Done |
| D3-08 | `voice_agent_settings` on owner merchant | Operator |
| D3-09 | Greeting UI updates owner row | Operator (V-07) |
| D4-01 | `retell_agent_id` on owner | Operator |
| D4-02 | Retell dashboard webhook URL | Operator |
| D4-03 | Retell env at boot | Done (`verify:voice-env`) |
| D4-04 | Inbound test call answers | Operator |
| D4-05 | Logs show owner `customer_id` | Operator (V-02) |
| D4-06 | `voice_call_log.customer_id` | Operator (V-03) |
| D4-07 | Inbound troubleshooting runbook | Done (docs) |
| G-01 | V-01 Owner login | Operator |
| G-02 | V-02 Inbound tenant | Operator |
| G-03 | V-03 Call log tenant | Operator |
| G-04 | V-08 Landing demo call | Operator |
| G-05 | V-07 No akin-dunbar for owner | Operator |
| G-06 | `npm run test:e2e:login` | Done (gate runs) |
| G-07 | Week 1 handoff template | Done (doc) |

---

## Verification matrix

| ID | Check | Status |
|----|-------|--------|
| V-01 | Owner `/login` | Operator |
| V-02 | Inbound → owner `customer_id` | Operator |
| V-03 | `voice_call_log.customer_id` | Operator |
| V-04 | Greeting = Retell behavior | Done (W3 Retell-first + UI sync) |
| V-05 | Kelly pause/resume sync | Done (`agent-lifecycle.js`) |
| V-06 | E2E login + voice specs | Done |
| V-07 | No akin-dunbar for owner | Done (code) / Operator (verify) |
| V-08 | Landing demo call | Operator |

---

## Week 2 — Tenant + voice scope

| ID | Item | Status |
|----|------|--------|
| W2-00 | Single transaction tenant provision | Done |
| W2-01 | Migration `053` voice tenant columns | Done |
| W2-02 | `customer_id` on inbound + call state | Done |
| W2-03 | Backfill script | Done |
| W2-04 | `saas-tenant-provision.js` | Done |
| W2-05 | Auth requires `merchant_id` post-terms | Done |
| W2-06 | `/voice/incoming?customer_id=` | Done |
| W2-07 | Single lifecycle writer | Done |
| W2-08 | Legacy signup 410 | Done |
| W2-09 | Tenant audit script | Done |
| W2-10 | `ALLOW_DEMO_SEED=1` gate | Done |
| W2-11 | Voice tenant integration test | Done |

---

## Week 3 — Prompt SSOT + UI

| ID | Item | Status |
|----|------|--------|
| W3-01 | Prompt SSOT ADR | Done |
| W3-02 | Retell-first greeting save | Done |
| W3-03 | 502 on Retell failure | Done |
| W3-04 | `prompt_profiles.customer_id` | Done (migration 054) |
| W3-05 | UI last-sync + toast | Done |
| W3-06 | LangGraph checkpointer dev doc | Done |

---

## Week 4 — Trial + rebrand

| ID | Item | Status |
|----|------|--------|
| W4-01 | Trial SIM E2E hardened | Done |
| W4-02 | Trial lifecycle runbook | Done |
| W4-03 | International phone | Deferred |
| W4-04 | Attach script `--dry-run` / `--update-webhook` | Done |
| W4-05 | Trial phone verify gate | Done |
| W4-06 | Somo rebrand (trial-alerts, billing alerts) | Done |
| W4-07 | Legacy signup audit | Done |
| W4-07c | Duplicate users audit script | Done |
| W4-08 | SomoPay scope doc | Done |
| W4-09 | Trial nudge emails + sweep | Done |

---

## Hygiene

| ID | Item | Status |
|----|------|--------|
| H-01 | Remove `127.0.0.1:7543` debug ingest | Done |
| H-02 | Remove default `legacy-clinic` fallback | Done |
| H-03 | 7543 from server/database paths | Done |
| H-04 | Docs under `docs/Database/` | Done |
| H-05 | Architecture cross-links | Done |
| H-06 | Phone semantics ADR | Done |
| H-07 | `ensureBillingTables()` extract | Done |
| H-08 | FK policy doc + dev PRAGMA | Done |

---

## Platform / deferred

| ID | Item | Status |
|----|------|--------|
| P1-06 | Postgres DLQ monitoring | Deferred |
| P1-09 | Admin role column | Deferred |

---

## Scripts reference

| Command | Purpose |
|---------|---------|
| `npm run verify:voice-env` | D1-04 / D4-03 env checklist |
| `npm run gate:week1` | Week 1 automated gate |
| `npm run ensure:somo-owner` | Owner bootstrap |
| `npm run db:purge-test-tenants` | Clean test rows |
| `npm run db:tenant-audit` | Tenant counts |
| `npm run trial:nudge-sweep` | Scheduled trial nudges |
| `npm run audit:duplicate-identities` | W4-07c report |
| `npm run test:e2e:trial` | Trial signup E2E |
| `npm run test:e2e:login` | Somo login E2E |

---

## Operator runbook (once)

1. `npm run db:purge-test-tenants` (optional)
2. `npm run ensure:somo-owner`
3. `node scripts/attach-existing-twilio-number.cjs ... --update-webhook`
4. Configure Retell dashboard URL
5. Place one inbound call + landing demo
6. `npm run gate:week1`

See [SOMO_FOUNDATION_RUNBOOK.md](./SOMO_FOUNDATION_RUNBOOK.md).
