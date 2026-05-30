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
