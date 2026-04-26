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

