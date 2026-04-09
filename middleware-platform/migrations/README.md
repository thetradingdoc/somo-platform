# Database migrations

**Last Updated:** April 9, 2026

Versioned migrations run when `database.js` loads (and via `npm run migrate`). Add new numbered files here; see `runMigrations()` in `database.js` for how files are picked up.

## Format

- `NNN_description.js` — migration modules (numeric prefix keeps order)
- Each migration should be idempotent (e.g. use `IF NOT EXISTS`)
- Migrations track applied versions in `schema_migrations` table

## Adding a migration

1. Create `migrations/NNN_description.js`
2. Export `function up(db) { ... }` and optionally `function down(db) { ... }`
3. Migrations run automatically when the server starts (database is required).
4. To run manually: `npm run migrate` or `node -e "require('./database').runMigrations()"`

## Examples (non-exhaustive)

- `012_triage_differentials.js` — `differentials` on `triage_rag_results`
- `025_session_result_snapshot_and_edits.js` — session result snapshots and user edits

Inspect `migrations/*.js` for the full set.
