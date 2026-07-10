# Postgres mirror — eventual consistency (Phase 7.2)

SQLite on Cloud Run is the **authoritative write path** for Kelly session state (`kelly_rails_session_projection`), `kelly_call_events`, and conversation history.

Postgres (`POSTGRES_URL`) receives **async dual-write** for:

- `clinics`, `clinic_phone_numbers`
- `appointments`
- `voice_call_log`
- `voice_checkout` / `function_call_log`

This mirror is **not transactional** with SQLite. Treat it as **eventual-consistency-only**.

## Staleness bound

| Constant | Default | Env override |
|----------|---------|--------------|
| Max mirror lag | **120 seconds** | `POSTGRES_MIRROR_STALENESS_SEC` |
| Retry queue alert | **25 rows** | `POSTGRES_SYNC_RETRY_ALERT_DEPTH` |
| DLQ alert | **≥1 row** | `POSTGRES_SYNC_DLQ_ALERT_MIN` |

Policy source: `middleware-platform/config/postgres-mirror-policy.js`

## Verification

```bash
cd middleware-platform
node scripts/verify-postgres-mirror-lag.cjs
STRICT=1 node scripts/verify-postgres-mirror-lag.cjs   # fail on breach
```

## Read routing when `POSTGRES_PRIMARY=1`

GCS SQLite snapshots may show **zero** `kelly_call_events` even when calls occurred. Verify scripts must use:

1. **Retell API** (`RETELL_API_KEY`) — transcript + call metadata
2. **Postgres `voice_call_log`** — call count proxy
3. **Not** empty GCS pull alone

See `scripts/lib/kelly-events-read-source.cjs` and `scripts/verify-postgres-gcs-reconciliation.cjs`.

## Retry worker

`services/postgres-sync-worker.js` polls `postgres_sync_retry` every 60s with exponential backoff. Failed rows after 5 attempts move to `postgres_sync_dlq`.

**Alert:** run `verify-postgres-mirror-lag.cjs` in deploy gate or nightly ops cron.
