# Database documentation index

> **Last reviewed:** 2026-07-10

## Somo voice foundation (start here)

| Document | Purpose |
|----------|---------|
| [ENV_AND_DB_SSOT.md](./ENV_AND_DB_SSOT.md) | `DB_PATH`, `NODE_ENV`, Postgres optional mirror, voice env checklist |
| [PROD_DB_PARITY.md](../deployment/PROD_DB_PARITY.md) | Prod row counts, ~3.1 GB GCS snapshot, 8 Gi Cloud Run note |
| [Medical Coding OPERATIONS](../Medical%20Coding/OPERATIONS.md) | Codebook import, embeddings, GCS pull/push |
| [TENANT_MODEL.md](./TENANT_MODEL.md) | `merchants` / `customers` / `clinics` / `users` |
| [PHONE_NUMBERS.md](./PHONE_NUMBERS.md) | Contact vs inbound vs clinic routing |
| [VOICE_AGENT_STATE.md](./VOICE_AGENT_STATE.md) | Settings vs per-call tables, Retell/Kelly |
| [SOMO_FOUNDATION_RUNBOOK.md](./SOMO_FOUNDATION_RUNBOOK.md) | Week 1 Day 1–5 + verification matrix |
| [WEEK1_HANDOFF_TEMPLATE.md](./WEEK1_HANDOFF_TEMPLATE.md) | Post-gate handoff fields |

## Platform database (existing)

| Document | Purpose |
|----------|---------|
| [DB_STRUCTURE_AND_PIPELINE.md](./DB_STRUCTURE_AND_PIPELINE.md) | SQLite facade, migrations, Postgres path |
| [middleware-platform/database.js](../../middleware-platform/database.js) | Stable import path for app code |
| [deployment § Postgres migration](../deployment/README.md#database-postgres-migration) | Export/seed and Azure Bicep notes |

## Runbooks

| Document | Purpose |
|----------|---------|
| [voice-inbound-troubleshooting.md](../runbooks/voice-inbound-troubleshooting.md) | Twilio → Retell → DB trace |
| [prod-preflight-census.md](../runbooks/prod-preflight-census.md) | Read-only prod census (D2-07) |
| [wipe-tenant-data.md](../runbooks/wipe-tenant-data.md) | Stripe → Twilio → Retell → DB |

## Architecture ADRs

| Document | Purpose |
|----------|---------|
| [VOICE_PHONE_SEMANTICS.md](../architecture/VOICE_PHONE_SEMANTICS.md) | Contact vs inbound ADR |
| [VOICE_PROMPT_SSOT.md](../architecture/VOICE_PROMPT_SSOT.md) | Retell-first prompt (Week 3) |
| [LANGGRAPH_CHECKPOINTER_DEV.md](../architecture/LANGGRAPH_CHECKPOINTER_DEV.md) | Dev checkpointer decision (W3-00) |

## Repositories (Phase 1+)

New domain SQL lives under [`middleware-platform/database/repos/`](../../middleware-platform/database/repos/) (health-session, payment). **Do not add CREATE TABLE to `database.js`** — use numbered migrations in [`middleware-platform/migrations/`](../../middleware-platform/migrations/).

## Postgres

- Startup migrations: [`database/migrations/run-startup-migrations.js`](../../middleware-platform/database/migrations/run-startup-migrations.js)
- Numbered migrations: [`middleware-platform/migrations/`](../../middleware-platform/migrations/) (`001`–`053+`)
- Export script: `npm run export:postgres` in middleware-platform

## Related

- [CANONICAL_DOC_MAP](../meta/CANONICAL_DOC_MAP.md)
- [CURRENT_STATE_ARCHITECTURE](../architecture/CURRENT_STATE_ARCHITECTURE.md)
- [auth-entrypoints.md](../auth/auth-entrypoints.md)
