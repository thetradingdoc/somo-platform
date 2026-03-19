# Database Migrations (Task 23)

Versioned migrations run on database initialization. Schema changes should be added here as new migration files.

## Format

- `001_description.js` - Migration files run in lexical order
- Each migration should be idempotent (e.g. use `IF NOT EXISTS`)
- Migrations track applied versions in `schema_migrations` table

## Adding a migration

1. Create `migrations/NNN_description.js`
2. Export `function up(db) { ... }` and optionally `function down(db) { ... }`
3. Migrations run automatically when the server starts (database is required).
4. To run manually: `npm run migrate` or `node -e "require('./database').runMigrations()"`

## Recent migrations

- `012_triage_differentials` — Adds `differentials` column to `triage_rag_results` (Stage 3 triage)
