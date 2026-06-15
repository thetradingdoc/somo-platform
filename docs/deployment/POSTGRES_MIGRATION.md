# Postgres migration path (E1)

Current: SQLite per Cloud Run instance with GCS sync (`GCS_DB_BUCKET`).

## Target

- Cloud SQL Postgres for multi-tenant durability
- `usage_events`, `voice_call_log`, `customers` as first migrated tables
- Existing `syncVoiceCallToPostgres` hooks become primary writes

## Steps (future)

1. Enable `POSTGRES_URL` on Cloud Run (already in secret list)
2. Dual-write from `applyUsage` and `logVoiceCall`
3. Cut over reads per route
4. Retire SQLite for hot paths

Not blocking voice billing Phase 0–2.
