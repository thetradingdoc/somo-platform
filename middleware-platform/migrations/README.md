# Database Migrations (Task 23)

Versioned migrations run on database initialization. Schema changes should be added here as new migration files.

## Format

- `001_description.js` - Migration files run in lexical order
- Each migration should be idempotent (e.g. use `IF NOT EXISTS`)
- Migrations track applied versions in `schema_migrations` table

## Adding a migration

1. Create `migrations/NNN_description.js`
2. Export `async function up(db) { ... }` and optionally `async function down(db) { ... }`
3. Run `node -e "require('./database').runMigrations()"` or let server startup apply it
