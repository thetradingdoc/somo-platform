# Payor Batch Reprocessing

## Scope
- Reprocess a payor batch when normalization/scoring policy changes or raw source mapping improves.

## Inputs
- `DB_PATH`
- `policy-version` (for Step 5/6 scoping)
- optional `scorer-version`

## Procedure
- Re-run normalization for all current source records:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-normalization.cjs --version=v1 --limit=50000`
- Rebuild blocking candidates:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-blocking.cjs --version=v1 --max-bucket=500`
- Recompute fuzzy scores:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-fuzzy-match.cjs --scorer-version=v1 --limit=200000`
- Recompute decisions with explicit policy:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-resolution-decisions.cjs --policy-version=v2_tuned --policy-profile=tuned_v2 --limit=200000`
- Rebuild canonical entities scoped to the policy:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-canonicalization.cjs --policy-version=v2_tuned --limit=200000`

## Post-Checks
- Run:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/report-payor-observability-ops.cjs --policy-version=v2_tuned`
- Confirm:
  - data quality checks pass
  - review queue metrics are non-zero for human adjudication

## Consumer layer reprocess (added)

When MA consumer-search outputs must be refreshed after source updates:

1. `DB_PATH=... node middleware-platform/scripts/run-payor-pbp-benefits-ingest.cjs`
2. `DB_PATH=... LANDSCAPE_CSV=... node middleware-platform/scripts/run-payor-landscape-premium-ingest.cjs`
3. `DB_PATH=... SERVICE_AREA_CSV=... node middleware-platform/scripts/run-payor-service-area-ingest.cjs`
4. `DB_PATH=... CROSSWALK_FILE=... node middleware-platform/scripts/run-payor-zip-county-crosswalk-ingest.cjs`

Then run one ZIP+needs validation query (or call `/api/public/plans/search`).

