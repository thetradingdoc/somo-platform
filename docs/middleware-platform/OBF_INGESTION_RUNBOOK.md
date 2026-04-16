# OBF Ingestion Runbook (Baseline + Delta + Master Catalog Serving)

## Scope

This runbook ingests Open Beauty Facts data into DocLittle's local serving index:

- `products_obf_index` (barcode lookup + taxonomy fields)
- `obf_ingestion_runs` (pipeline observability)
- `obf_delta_applied` (idempotent delta tracking)
- `obf_ingestion_dlq` (malformed/failed rows)

Raw files are stored in GCS under `OBF_GCS_PREFIX`.

## Storage layout

Default prefix: `gs://skinandcare-media-staging/obf`

- `raw/full/` baseline snapshot(s)
- `raw/delta/` delta files from `index.txt`
- `meta/` copied index snapshots
- `checkpoints/last_applied_delta.txt` operational marker

## Baseline job

CSV fallback baseline (current reliable URL):

```bash
cd middleware-platform
OBF_GCS_PREFIX="gs://skinandcare-media-staging/obf" npm run obf:baseline:csv
```

This performs:

1. copy baseline CSV gz to GCS
2. parse + upsert rows into `products_obf_index`
3. initialize checkpoint marker

## Delta job (daily)

```bash
cd middleware-platform
OBF_GCS_PREFIX="gs://skinandcare-media-staging/obf" npm run obf:delta:sync
```

This performs:

1. read OBF delta index
2. copy unseen deltas to GCS
3. apply each unseen delta idempotently
4. write per-run metrics and status

## Runtime serving behavior (master-first)

`GET /api/public/beautyfacts/:barcode` uses:

1. `products_obf_index` master index first (`OBF_INDEX_CACHE_READ != 0`)
2. if miss, calls live OBF API as fallback
3. upserts fallback result back into `products_obf_index`

Response includes `data_source`: `obf_index_cache` or `live_api`.

`GET /api/public/foodfacts/:barcode` follows the same pattern against
`products_off_index` (`off_index_cache` or `live_api`).

## Canonical catalog observability

Use these admin APIs to avoid split reporting:

- `GET /api/admin/catalog/master-stats` — canonical catalog size + latest ingestion/delta state
- `GET /api/admin/metrics` — includes `catalog_master` KPI:
  - `served_from_master_rate`
  - `catalog_size`
  - `fallback_rate`

### KPI policy

- Track one primary KPI: `% scans served from master catalog` (`served_from_master_rate`).
- Alert when it drops below `CATALOG_MASTER_MIN_RATE` (default `0.85`).
- Keep one canonical “total catalog size” from `catalog_master.catalog_size`.

## Observability

Metrics keys:

- `obf.baseline.rows_seen.count`
- `obf.baseline.rows_upserted.count`
- `obf.baseline.rows_failed.count`
- `obf.delta.pending.count`
- `obf.delta.applied.count`
- `obf.delta.failed.count`
- `obf.index_cache.hit.count`
- `obf.index_cache.miss.count`
- `off.index_cache.hit.count`
- `off.index_cache.miss.count`
- `catalog.master.sync.success.count`
- `catalog.master.sync.failed.count`

## In-process sync worker (server startup)

The middleware server can keep the master catalog fresh without an external cron
by running delta sync on an interval.

Environment flags:

- `CATALOG_MASTER_SYNC_ENABLED` (default: enabled in production)
- `CATALOG_MASTER_SYNC_INTERVAL_MS` (default: 24h)
- `CATALOG_MASTER_BOOTSTRAP_BASELINE_ON_EMPTY` (default: `false`)
- `CATALOG_MASTER_MIN_RATE` (default: `0.85`)

## Scheduler

Daily delta schedule (example):

```bash
gcloud scheduler jobs create http obf-delta-daily \
  --location=us-east4 \
  --schedule="15 3 * * *" \
  --uri="https://REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT/jobs/obf-delta-sync:run" \
  --http-method=POST \
  --oauth-service-account-email="SERVICE_ACCOUNT" \
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform"
```

Monthly rebaseline:

```bash
gcloud scheduler jobs create http obf-baseline-monthly \
  --location=us-east4 \
  --schedule="0 4 1 * *" \
  --uri="https://REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT/jobs/obf-baseline:run" \
  --http-method=POST \
  --oauth-service-account-email="SERVICE_ACCOUNT" \
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform"
```

## Security follow-up

After moving Cloud Run env to Secret Manager refs, rotate all previously exposed external API keys and revoke leaked service-account private keys.
