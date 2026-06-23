# Postgres migration path (E1)

Current: SQLite per Cloud Run instance with GCS sync (`GCS_DB_BUCKET`).

## Target

- Cloud SQL Postgres for multi-tenant durability
- `kelly_rails_session_projection`, `kelly_call_events`, `usage_events`, `voice_call_log` as migrated tables
- `syncVoiceCallToPostgres` + hot-path mirrors become primary when `POSTGRES_PRIMARY=1`

## Flags

| Flag | Effect |
|------|--------|
| `POSTGRES_URL` | Cloud SQL connection (Secret Manager on staging) |
| `KELLY_RAILS_SSOT_POSTGRES=1` | Dual-write session projection; reads prefer Postgres cache |
| `POSTGRES_PRIMARY=1` | Mirror `kelly_call_events` and `usage_events` to Postgres |

Staging deploy (`./scripts/deploy-to-gcp.sh`) always re-applies these via `--update-env-vars` alongside `--env-vars-file`.

## Staging cutover (completed wiring)

1. Ensure `POSTGRES_URL` secret exists in GCP Secret Manager (`somo-staging-postgres-url`).
2. Deploy staging with default env guard (`KELLY_RAILS_SSOT_POSTGRES=1`, `POSTGRES_PRIMARY=1`).
3. Validate after deploy:

```bash
# Session projection + OPQRST freeze path
KELLY_RAILS_SSOT_POSTGRES=1 node middleware-platform/scripts/opqrst-freeze-e2e.cjs

# Identity / tenant smoke (against staging API)
CLOUDRUN_BASE_URL=https://api.callsomo.com node scripts/capstone-identity-smoke.cjs
```

4. Place a test call, redeploy, confirm `triage_sessions` / projection row survives (Postgres + GCS).

## Rollback

Flip flags off on the Cloud Run service (no redeploy of app code required):

```bash
gcloud run services update somo-middleware \
  --region=us-central1 \
  --update-env-vars KELLY_RAILS_SSOT_POSTGRES=0,POSTGRES_PRIMARY=0
```

SQLite + GCS download still works; reads revert to SQLite projection table.

Emergency: set `GCS_DB_UPLOAD_FORCE=1` only if upload preflight blocks a known-good DB snapshot.

## GCS upload alerts (Cloud Logging)

Filter staging/production logs for structured upload events:

```
jsonPayload.event=("gcs_db_upload_refused" OR "gcs_db_upload_failed")
```

Metrics counters (in-process, scrape via `/metrics` or logs):

- `gcs_db_upload_refused` — preflight blocked upload (operator missing, tenant bind fail)
- `gcs_db_upload_failed` — snapshot or GCS upload error

Post-deploy: run `npm run verify:gcs-sqlite-contention` when `DB_PATH` or GCS backup is available.

## Tenant column backfill (before migration 074/076)

```bash
DB_PATH=./middleware-staging.db node middleware-platform/scripts/backfill-site-context-tenant-columns.cjs
node middleware-platform/scripts/verify-tenant-columns-null-free.cjs
```

`ci:slow` runs `verify-tenant-columns-null-free.cjs --check-only` when `var/db/middleware-dev.db` exists.

## Steps (remaining)

1. Flip reads for billing routes to Postgres-only
2. Retire GCS SQLite hot path for session data after 48h clean telemetry

Not blocking voice billing Phase 0–2.

## Ops sign-off checklist (RS-2-07)

Before flipping `POSTGRES_PRIMARY=1` on production:

1. Staging has run dual-write (`KELLY_RAILS_SSOT_POSTGRES=1`) for **48h** with clean telemetry (no `postgres_sync_dlq` growth).
2. Parity script passes:

```bash
POSTGRES_URL=... POSTGRES_PRIMARY=1 npm run verify:postgres-primary-parity --prefix middleware-platform
```

3. Operator records evidence JSON in deploy ticket.
4. Rollback command tested on staging (flags off, SQLite reads restore).

CI uses `--check-only` when Postgres is unavailable:

```bash
npm run verify:postgres-primary-parity --prefix middleware-platform -- --check-only
```
