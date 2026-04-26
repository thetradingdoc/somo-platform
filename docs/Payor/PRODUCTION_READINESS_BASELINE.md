# Payor ER Production Readiness Baseline

## Purpose

Define explicit acceptance criteria for the first network-unrestricted payor ER run with real source coverage (Office Ally + Inovalon + NPPES), so readiness is pass/fail instead of subjective.

## Current Controlled-Environment Status

- Source contamination from `nucc_csv` / `nucc` is excluded from payor ER blocking scope.
- Degraded-mode NPPES-only run yielding `candidate_pair_count = 0` is expected and acceptable.
- Provider routing split, drift checks, and precheck behavior are validated in controlled tests.

## First Real Run Acceptance Criteria

```js
const ACCEPTANCE_CRITERIA_FIRST_REAL_RUN = {
  eligible_record_count:  { min: 8000 },  // OA + Inovalon + NPPES org records minus null/invalid rows
  candidate_pair_count:   { min: 500 },   // cross-source blocking should generate non-trivial candidate set
  auto_merge_rate:        { min: 0.15 },  // floor expectation for high-confidence national payer overlaps
  top_pair_quality:       'org names only, zero person-name collisions in top scored pairs',
  routed_provider_rows:   { min: 1 },     // confirms Type-1 routing path is actively exercised
  routed_payor_rows:      { min: 1 }      // confirms Type-2 payer routing path is actively exercised
};
```

## Hard Fail Conditions

- Any top scored pair in quality sample contains obvious person-only names.
- `routed_provider_rows = 0` or `routed_payor_rows = 0` after ingest run.
- `candidate_pair_count = 0` when Office Ally and Inovalon are present.
- Source contamination reappears in payor ER scope (for example, `nucc_csv` in blocking sources).

## CMS-authoritative track (no Office Ally / Inovalon)

When vendor files are intentionally out of scope, use **`PAYOR_READINESS_VENDOR_MODE=cms_only`** (or **`PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1`**) for Step 0–2 readiness so OA/Inovalon gates are waived. Treat “first real run” quality against **NPPES + CMS MA (+ NUCC where applicable)** only.

Suggested acceptance object for that track (adjust minima after first national bulk ingest):

```js
const ACCEPTANCE_CRITERIA_CMS_AUTHORITATIVE = {
  eligible_record_count:  { min: 1000 },   // payor-shaped rows after null/invalid drops (tune after ingest)
  candidate_pair_count:   { min: 0 },      // 0 acceptable until multi-source overlap exists beyond NPPES-only
  auto_merge_rate:        { min: 0 },       // not meaningful until blocking produces merge candidates
  top_pair_quality:       'org names only; no person-name collisions in scored samples',
  routed_provider_rows:   { min: 1 },      // still require routing paths exercised when Type-1 data exists
  routed_payor_rows:      { min: 1 }       // Type-2 / payer routing exercised after nppes_bulk (or equivalent) ingest
};
```

Hard fails for CMS-only remain: person-name collisions in top pairs, **zero** routed provider/payor rows when the corresponding ingest tables are populated, and source contamination in blocking scope.

Operator checklist (commands, `DB_PATH`, env toggles, drift seed): **`docs/Payor/PAYOR_CMS_TRACK_RUNBOOK.md`**.

## Validation Sequence for First Real Run

1. Run Tier-1 ingest with network-unrestricted access.
2. Run normalization, blocking, fuzzy-match, resolution-decisions, and observability report.
3. Validate against baseline thresholds above.
4. Archive report artifacts with timestamp and commit SHA.

