# Postgres Sync Backlog (>100 Pending)

## Symptoms

- `retry_queue_depth` >100 in `GET /api/admin/metrics`
- `postgres_sync_retry` table has many rows
- Logs show repeated Postgres sync failures
- Postgres sync worker processing but not draining queue

## Impact

- **Data inconsistency** — SQLite and Postgres out of sync for clinics, appointments, voice_call_log, etc.
- **Reporting** — Postgres-based reports or external systems missing recent data
- **Billing** — Delayed sync of voice_checkout or function_call_log may affect reconciliation

## Diagnosis

1. **Check metrics**: `GET /api/admin/metrics` — `retry_queue_depth`, `dlq_size`
2. **Query retry table**: `SELECT entity_type, COUNT(*), MAX(last_error) FROM postgres_sync_retry GROUP BY entity_type`
3. **Check Postgres** — Connection, credentials, disk space, locks
4. **Check worker** — `postgres-sync-worker.js` runs every 60s; verify it is running
5. **Review `last_error`** — Common causes: connection refused, timeout, constraint violation

## Mitigation

1. **Fix Postgres** — Restart if hung; resolve connection/credential issues
2. **Increase worker concurrency** — If single-threaded, consider processing larger batches
3. **Prioritize** — Worker processes by `priority` (1=high, 2=medium, 3=low); high-priority syncs first

## Resolution

1. **Worker drains queue** — Once Postgres healthy, worker retries with exponential backoff (1s, 2s, 4s, 8s, 16s)
2. **DLQ** — After 5 failed attempts, rows move to `postgres_sync_dlq`; manual replay may be needed
3. **Verify** — Confirm `retry_queue_depth` drops; check Postgres for synced data

## Prevention

- Monitor `retry_queue_depth`; alert if >100
- Ensure Postgres has adequate connections and resources
- Runbook: [DR.md](./DR.md) for Postgres restore if DB corruption
