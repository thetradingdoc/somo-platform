# Database documentation index

> **Last reviewed:** 2026-05-25

## Read first

| Document | Purpose |
|----------|---------|
| [DB_STRUCTURE_AND_PIPELINE.md](./DB_STRUCTURE_AND_PIPELINE.md) | SQLite facade, migrations, Postgres path |
| [middleware-platform/database.js](../../middleware-platform/database.js) | Stable import path for app code |
| [deployment § Postgres migration](../deployment/README.md#database-postgres-migration) | Export/seed and Azure Bicep notes |

## Repositories (Phase 1+)

New domain SQL lives under [`middleware-platform/database/repositories/`](../../middleware-platform/database/repositories/) and is re-exported from `database.js`.

| Repository | Domain |
|------------|--------|
| `medical-codes.js` | ICD-10, CPT, HCPCS, embeddings |
| (others) | See [`middleware-platform/ARCHITECTURE.md`](../../middleware-platform/ARCHITECTURE.md) |

## Medical codebook tables

Canonical ops: [Medical Coding/ARCHITECTURE.md](../Medical%20Coding/ARCHITECTURE.md) § data layer.

## Postgres

- Startup migrations: [`database/migrations/run-startup-migrations.js`](../../middleware-platform/database/migrations/run-startup-migrations.js)
- Numbered migrations: [`middleware-platform/migrations/`](../../middleware-platform/migrations/)
- Export script: `npm run export:postgres` in middleware-platform

## Related

- [CANONICAL_DOC_MAP](../meta/CANONICAL_DOC_MAP.md)
- [SERVER_DECOMPOSITION](../architecture/SERVER_DECOMPOSITION.md)
