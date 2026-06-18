# OPERATIONS

**Last updated:** 2026-06-02


---

<a id="db-structure-and-pipeline"></a>

## DB STRUCTURE AND PIPELINE

*Merged from `docs/Database/DB_STRUCTURE_AND_PIPELINE.md` on 2026-06-02.*

# Database structure and pipeline

> **Last reviewed:** 2026-05-29

## Runtime model

```text
require('./database')  →  database.js facade
                            → database/repositories/* (domain SQL)
                            → SQLite file (default: middleware-dev.db)
                            → optional Postgres sync (env-driven)
```

**Rule:** Application code imports `database.js` only — do not bypass the facade during refactors.

## SQLite (development / default)

| Env | Effect |
|-----|--------|
| `DB_PATH` | Override SQLite filename under middleware data directory |
| `SKIP_STARTUP_MIGRATIONS=1` | Skip startup migration batch (scripts, eval) |

Schema changes:

1. Add `migrate*()` or numbered file under `middleware-platform/migrations/NNN_*.js`
2. Register in [`run-startup-migrations.js`](../../middleware-platform/database/migrations/run-startup-migrations.js)

## Somo voice SaaS tables

Provider login, trial, and inbound voice use **`customers`** as the SaaS tenant key. See [TENANT_MODEL.md](./TENANT_MODEL.md) and [VOICE_AGENT_STATE.md](./VOICE_AGENT_STATE.md).

| Group | Examples |
|-------|----------|
| SaaS tenant | `customers`, `customer_sessions`, `merchants`, `clinics` |
| Voice config | `voice_agent_settings`, `customers.retell_agent_id` |
| Voice per-call | `voice_call_log`, `voice_call_states`, `voice_conversation_memory`, `agent_turns` |
| Phone routing | `customers.twilio_phone_*`, `clinic_phone_numbers` |

Operational Week 1 steps: [SOMO_FOUNDATION_RUNBOOK.md](./SOMO_FOUNDATION_RUNBOOK.md).

## Major table groups

| Group | Examples |
|-------|----------|
| Multi-tenant | clinics, customers, appointments |
| Voice / triage | triage_sessions, voice_call_states |
| Medical codes | icd10_codes, cpt_codes, hcpcs_codes, code_embeddings, fee_schedules |
| Payor / NPPES | provider_registry_entities, provider_payer_networks, payor_* |
| Patient routine | patient_routine_*, item_logs (see patient timeline doc) |
| Commerce | merchant_orders, products, knowledge_chunks |

Patient routine API detail: [`PATIENT_TIMELINE_ROUTINE_AND_BILLING.md`](../architecture/patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md).

## Postgres migration path

Production roadmap: managed Postgres instead of embedded SQLite.

1. **Export seed:** `npm run export:postgres` → `backups/postgres-seed-<timestamp>.sql`
2. **Apply:** `psql` or Azure Cloud Shell against target instance
3. **Infra:** `infra/bicep/app-service-with-postgres.bicep` (Azure template in repo)

Full procedure: [deployment README § Postgres](../deployment/README.md#database-postgres-migration).

## Medical codebook ingest (offline)

Not part of startup migrations — run scripts explicitly:

```bash
node scripts/import-icd10-codes.js
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/populate-code-embeddings.js --until-done
```

See [MEDICAL_CODEBOOK_SETUP.md](../deployment/MEDICAL_CODEBOOK_SETUP.md).

## Verification

| Command | Checks |
|---------|--------|
| `npm run verify:prod-codebook` | CPT row count + embeddings |
| `npm run verify:payor:sqlite-context` | NPPES / payor SQLite context |


---

<a id="env-and-db-ssot"></a>

## ENV AND DB SSOT

*Merged from `docs/Database/ENV_AND_DB_SSOT.md` on 2026-06-02.*

# Environment and database single source of truth

> **Last reviewed:** 2026-05-29  
> **Audience:** Anyone running middleware locally or debugging tenant/voice issues.

## SQLite file resolution

The active database path is chosen in [`middleware-platform/database.js`](../../middleware-platform/database.js) at process start. Look for this log line:

```text
📁 Database path: /absolute/path/to/middleware-dev.db (environment: development)
```

### Variables (priority order)

| Variable | Purpose | Dev typical | Prod typical |
|----------|---------|-------------|--------------|
| `DB_PATH` | **Highest priority** — absolute or cwd-relative path to the `.db` file | `./var/db/middleware-dev.db` (see [`scripts/dev/run.sh`](../../scripts/dev/run.sh)) | Set explicitly on App Service |
| `DB_NAME` | Filename only when `DB_PATH` unset | *(unset → `middleware-dev.db`)* | `middleware-prod.db` |
| `NODE_ENV` | Selects default filename when `DB_NAME` unset | `development` | `production` |
| `POSTGRES_URL` | Optional Postgres pool + sync mirror (not full SQLite replacement) | Usually unset | Set when using managed Postgres |
| `SKIP_STARTUP_MIGRATIONS` | Skip inline `migrate*()` batch in `database.js` | `1` for one-off scripts only | Do not set |
| `SQLITE_BUSY_TIMEOUT_MS` | Writer lock wait (default 60000) | Default | Default or raise under load |

### Dev quick start (canonical)

From repo root [`run`](../../run):

```bash
cd middleware-platform
export DB_PATH=./middleware-dev.db
npm start
```

The file is resolved with `path.resolve(process.cwd(), DB_PATH)` — run middleware from `middleware-platform/` so the DB lives beside `package.json`.

### Verify path at runtime

```bash
curl -s 'http://localhost:4000/health?show_db_path=1' | jq .database_path
```

## Postgres (optional)

When `POSTGRES_URL` is set:

- Startup logs: `🗄️  POSTGRES_URL detected – Postgres pool initialized`
- SQLite remains the primary write path for most domains; selected entities sync via `postgres_sync_retry` / DLQ (see [DB_STRUCTURE_AND_PIPELINE.md](./DB_STRUCTURE_AND_PIPELINE.md)).

## Voice and telephony environment checklist (D1-04)

Use this when inbound calls fail, Retell never connects, or settings land on the wrong merchant.

### Required for Week 1 gate (owner inbound + landing demo)

| Variable | Required | Role |
|----------|----------|------|
| `TWILIO_ACCOUNT_SID` | Yes (voice) | Twilio REST + webhook validation |
| `TWILIO_AUTH_TOKEN` | Yes | Signature validation on `/voice/incoming` |
| `API_BASE_URL` or `NGROK_URL` | Yes (dev) | Public HTTPS URL Twilio/Retell reach; dev: ngrok → `https://….ngrok-free.app` |
| `RETELL_API_KEY` | Yes | Agent create/update, runtime API |
| `RETELL_AGENT_ID` | Per-tenant | Often on `customers.retell_agent_id`; global fallback in env |
| `SOMO_OWNER_EMAIL` / `SOMO_OWNER_PASSWORD` | Dev login | See [`local/README.md`](../../local/README.md) |
| `SOMO_OWNER_CLINIC_PHONE` | Create owner | E.164 when account does not exist |

### Strongly recommended

| Variable | Role |
|----------|------|
| `RETELL_WEBHOOK_SECRET` | Validates Retell → middleware callbacks |
| `RETELL_VOICE_ID` | Default TTS voice for new agents |
| `TWILIO_WEBHOOK_SIGNATURE_REQUIRED` | `1` in production |
| `BASE_URL` | Fallback when `API_BASE_URL` unset (links in email/SMS) |

### Billing / trial (signup and SIM flow)

| Variable | Role |
|----------|------|
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Subscriptions, trial conversion |
| `TRIAL_SIM_FLOW_ENABLED` | Trial phone provisioning |
| `TWILIO_VERIFY_SERVICE_SID` | OTP for `phone_verified` |

### Public URL resolution order (code)

Middleware prefers: `PUBLIC_BASE_URL` → `API_BASE_URL` → `BASE_URL` → Railway host → localhost. Trial lifecycle also reads `NGROK_URL` when `API_BASE_URL` is not public HTTPS.

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](./SOMO_FOUNDATION_RUNBOOK.md) — Day 1–5 operational steps
- [`middleware-platform/.env.example`](../../middleware-platform/.env.example) — commented template
- [TENANT_MODEL.md](./TENANT_MODEL.md) — `customers` vs `merchants` vs `clinics`


---

<a id="tenant-model"></a>

## TENANT MODEL

*Merged from `docs/Database/TENANT_MODEL.md` on 2026-06-02.*

# Somo SaaS tenant model

> **Last reviewed:** 2026-05-29

## Three keys (today)

The platform evolved multiple tenant identifiers. They are **not** enforced as a strict 1:1:1 today.

| Key | Table | Primary use |
|-----|-------|-------------|
| `merchant_id` | `merchants` | Commerce subdomain, catalog, `voice_agent_settings` (preferred) |
| `customer_id` | `customers` | Provider `/login`, trial/Stripe, Twilio/Retell columns |
| `clinic_id` | `clinics` | Appointments, FHIR-adjacent flows, `clinic_phone_numbers` |

Legacy `users` rows still exist for older clinic-operator login; new Somo provider sign-in uses **`customers`** + `customer_sessions`.

## Target model (Week 2+)

For `customer_type = 'saas'` after onboarding completes:

```text
customers.merchant_id  →  merchants.id   (NOT NULL)
customers              →  clinics        (1 clinic per SaaS tenant, typical)
customers              →  users          (optional; deprecate for new signups)
```

Signup should create **merchant + customer + clinic** in one transaction (W2-04) so there are no customer-only trial orphans.

## Synthetic merchant keys (anti-pattern)

`voice_agent_settings` may use `merchant_id = 'cust:{customerId}'` when no real merchant exists. On merchant link, migrate to the real `merchant_id` (W2-06, D3-08).

## Default merchant fallback (P0)

Code paths that fall back to subdomain `akin-dunbar` when tenant context is missing cause **wrong greetings and Kelly config** for logged-in owners. Week 1 fixes this in:

- [`routes/voice-agent-settings.js`](../../middleware-platform/routes/voice-agent-settings.js)
- [`webhooks/retell-websocket.js`](../../middleware-platform/webhooks/retell-websocket.js)

Authenticated requests with `req.customer` must never resolve settings for another merchant.

## Auth entrypoints

| Surface | Identity store | Doc |
|---------|----------------|-----|
| Provider portal `/login` | `customers` | [auth-entrypoints.md](../auth/auth-entrypoints.md) |
| Admin `/admin` | `ADMIN_PORTAL_SECRET` (not email) | [ADMIN_VS_PROVIDER_LOGIN.md](../auth/ADMIN_VS_PROVIDER_LOGIN.md) |
| Patient portal | FHIR + portal sessions | auth-entrypoints.md |
| Legacy `/api/auth/signup` | `users` | Deprecate → `/signup` wizard (W4-07) |

## SQL: owner census (D2-04)

```sql
SELECT id, email, merchant_id, clinic_id, customer_type, trial_status,
       twilio_phone_number, retell_agent_id, phone_number, phone_verified
FROM customers
WHERE lower(email) = lower(?);
```

## Related

- [PHONE_NUMBERS.md](./PHONE_NUMBERS.md)
- [VOICE_AGENT_STATE.md](./VOICE_AGENT_STATE.md)
- [ENV_AND_DB_SSOT.md](./ENV_AND_DB_SSOT.md)


---

<a id="fk-enforcement"></a>

## FK ENFORCEMENT

*Merged from `docs/Database/FK_ENFORCEMENT.md` on 2026-06-02.*

# SQLite foreign key enforcement (H-08)

> **Last reviewed:** 2026-05-29

## Policy

- **Development:** Optional `PRAGMA foreign_keys=ON` after migrations complete.
- **Production:** Enable only after auditing legacy rows that violate FK constraints.

## Enable in dev

```bash
export SQLITE_FOREIGN_KEYS=1
cd middleware-platform && npm start
```

Startup logs: `SQLite foreign_keys=ON (SQLITE_FOREIGN_KEYS=1)`.

## Notes

- SQLite FK checks are off by default; numbered migrations in `middleware-platform/migrations/` must run first.
- Do not enable in production until a violation report is clean.

## Related

- [DB_STRUCTURE_AND_PIPELINE.md](./DB_STRUCTURE_AND_PIPELINE.md)


---

<a id="phone-numbers"></a>

## PHONE NUMBERS

*Merged from `docs/Database/PHONE_NUMBERS.md` on 2026-06-02.*

# Phone number fields

> **Last reviewed:** 2026-05-29  
> **ADR:** [VOICE_PHONE_SEMANTICS.md](../architecture/VOICE_PHONE_SEMANTICS.md)

## Four meanings in the schema

| Field / table | Meaning | Example use |
|---------------|---------|-------------|
| `customers.phone_number` | **Contact** — account recovery, OTP, trial verify | Owner mobile for SMS |
| `customers.phone_verified` | Contact verified (trial gate) | Must be `1` before `trial_status=active` (W2-09) |
| `customers.twilio_phone_number` | **Inbound voice line** (Twilio DID) | Callers dial this; webhook routes to tenant |
| `customers.twilio_phone_sid` | Twilio `IncomingPhoneNumbers` SID | Webhook updates via API |
| `clinics.phone_number` | Clinic record display / legacy | May differ from SaaS inbound line |
| `clinic_phone_numbers` | Routing map clinic ↔ E.164 | Multiple lines per clinic; often empty until provision |

## Contact vs inbound (owner setup)

For Somo owner dev:

- **Inbound:** `+18622307479` → `twilio_phone_number` + SID (D3-03 attach script)
- **Contact:** If owner texts OTP to a different mobile, set `phone_number` and `phone_verified=1` separately (D3-04)

Document both in your Week 1 handoff when they differ.

## Twilio webhook shape

```text
POST {PUBLIC_URL}/voice/incoming?customer_id={OWNER_CUSTOMER_ID}
```

`customer_id` in the query string binds the call to the SaaS tenant when the DID is shared or routing is explicit.

## Provisioning paths

| Path | Writes |
|------|--------|
| Trial SIM signup | Twilio purchase + `customers` + optional `clinic_phone_numbers` |
| `attach-existing-twilio-number.cjs` | Existing DID → `customers` + webhook + `clinic_phone_numbers` |
| `create-web-provider-account.js` | New tenant; may set clinic phone only |

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](./SOMO_FOUNDATION_RUNBOOK.md) — Day 3 Twilio bind
- [voice-inbound-troubleshooting.md](../runbooks/voice-inbound-troubleshooting.md)


---

<a id="voice-agent-state"></a>

## VOICE AGENT STATE

*Merged from `docs/Database/VOICE_AGENT_STATE.md` on 2026-06-02.*

# Voice agent configuration vs per-call state

> **Last reviewed:** 2026-05-29

## Tenant-scoped configuration (slow-changing)

| Store | Key | Notes |
|-------|-----|-------|
| `voice_agent_settings` | `merchant_id` (or legacy `cust:{customerId}`) | Greeting, hours, enabled |
| `customers.retell_agent_id` | `customer_id` | Retell agent resource |
| `customers.custom_prompt` | `customer_id` | Cache; Week 3: Retell API is runtime SSOT |
| `prompt_profiles` | `clinic_id` today | W3-04: add `customer_id` for SaaS without clinic |
| Retell dashboard | Agent webhook / WS URL | Must match `API_BASE_URL` / ngrok (D4-02) |

## Per-call state (fast-changing)

| Table | Scoped by | `customer_id` column |
|-------|-----------|----------------------|
| `voice_call_log` | `call_id`, **`customer_id`** | Yes (billing/audit) |
| `voice_call_states` | `call_id`, `clinic_id` | **Added W2-01** (`053` migration) |
| `voice_conversation_memory` | `call_id`, `clinic_id` | **Added W2-01** |
| `agent_turns` | `call_id`, `clinic_id` | **Added W2-01** |
| `agent_state_snapshots` | `call_id` | **Added W2-01** |

Week 1 gate (V-03): test inbound call → row in `voice_call_log` with owner `customer_id`.

Week 2 gate (W2-11): same `customer_id` on `voice_call_log` and `voice_call_states` for new calls.

## Runtime (not SQLite)

| Component | Scope |
|-----------|--------|
| `retell-websocket.js` `activeConnections` | In-memory per process |
| LangGraph checkpointer | Postgres prod / MemorySaver dev (see W3-00 ADR) |

## Prompt sync (Week 3)

Target flow:

1. **Read/write Retell API** for live agent prompt/greeting.
2. **Mirror** to `customers.custom_prompt` + `voice_agent_settings` with `prompt_synced_at`.
3. UI shows “Last synced with voice provider” and surfaces Retell errors.

## Backfill

After W2-01, run:

```bash
cd middleware-platform
node scripts/backfill-voice-call-customer-id.cjs
```

Joins state tables to `voice_call_log` by `call_id` (last 30 days).

## Related

- [VOICE_PHONE_SEMANTICS.md](../architecture/VOICE_PHONE_SEMANTICS.md)
- [voice-inbound-troubleshooting.md](../runbooks/voice-inbound-troubleshooting.md)
- [TENANT_MODEL.md](./TENANT_MODEL.md)


---

<a id="somo-foundation-runbook"></a>

## SOMO FOUNDATION RUNBOOK

*Merged from `docs/Database/SOMO_FOUNDATION_RUNBOOK.md` on 2026-06-02.*

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


---

<a id="week1-handoff-template"></a>

## WEEK1 HANDOFF TEMPLATE

*Merged from `docs/Database/WEEK1_HANDOFF_TEMPLATE.md` on 2026-06-02.*

# Week 1 handoff (copy and fill)

> Fill after Day 5 gate (G-07). Store instance under `docs/Database/handoffs/` if desired (gitignored copies OK).

```text
Date:
Engineer:

DB path:
Owner email:
Owner customer_id:
Owner merchant_id:
Owner clinic_id:

Twilio inbound E.164:
Twilio Phone SID (PN…):

Retell agent id:

Public URL (ngrok or API_BASE_URL):

Week 1 gate: V-01 V-02 V-03 V-07 V-08 G-06  [ ] pass  [ ] fail
Notes:
```


---

<a id="backlog-status"></a>

## BACKLOG STATUS

*Merged from `docs/Database/BACKLOG_STATUS.md` on 2026-06-02.*

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
