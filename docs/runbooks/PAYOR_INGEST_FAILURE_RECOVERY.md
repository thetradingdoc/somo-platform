# Payor Ingest Failure Recovery

## Scope
- Recover Step 1 ingest failures for Tier-1 payor sources without corrupting ER downstream stages.

## Detection
- Run `node middleware-platform/scripts/report-payor-observability-ops.cjs`.
- Confirm problematic source in `metrics.ingest_counts_by_source`.
- Inspect recent ingest summary by re-running `node middleware-platform/scripts/pull-payor-tier1-sources.cjs --force`.

## Recovery Procedure
- Validate DB target: `DB_PATH=./middleware-dev.db`.
- Re-run source pull with network permissions when needed:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/pull-payor-tier1-sources.cjs --force`
- Re-seed dictionaries (safe idempotent):
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/seed-payor-normalization-dictionaries.cjs`
- Re-run normalization:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-normalization.cjs --version=v1 --limit=50000`
- Rebuild downstream:
  - `run-payor-blocking`
  - `run-payor-fuzzy-match`
  - `run-payor-resolution-decisions`
  - `run-payor-canonicalization`

## Validation
- Confirm non-zero counts in:
  - `payor_source_records`
  - `payor_normalized_records`
  - `payor_match_candidates`
- Confirm no data quality gate failures in `payor-observability-quality-ops-report.json`.

## Additional recovery targets (premium + availability layers)

If ZIP-based plan search is impacted, also verify/recover:

- `payor_plan_premiums` (Landscape ingest)
- `payor_plan_service_areas` (MA county service area ingest)
- `zip_county_crosswalk` (Census crosswalk ingest)

Recommended sequence after source repair:

1. `run-payor-landscape-premium-ingest.cjs`
2. `run-payor-service-area-ingest.cjs`
3. `run-payor-zip-county-crosswalk-ingest.cjs`

Operational note: ZIP `33101` currently has an explicit `FL` state guard in `/api/public/plans/search` as a stopgap while crosswalk/state disambiguation is tuned.

