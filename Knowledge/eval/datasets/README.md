# Eval datasets (Phase 1)

**Last Updated:** April 9, 2026

## Files

| File | Description |
|------|-------------|
| `golden_dataset.json` | **Source** vendored from Reddit eval export (`post_id`, `question`, `ground_truth`, optional `contexts`, `rag_answer`). |
| `golden_dataset_cleaned.json` | **Generated** — same rows minus obvious **non-derm** noise (see `build-golden-slices.cjs`), each row has **`eval_phase1`**: `query_style`, `language`, `stratify_bucket`. |
| `golden_dataset_dropped.json` | **Audit** — rows removed with `drop_reason`. |
| `golden_stratified_slice_v1.json` | **Generated** — ~120 rows stratified across `high_risk`, `vague_or_worried`, `routine_product`, `keyword_synthetic`, `benign_education` (quotas in script). |
| `golden_phase1_manifest.json` | **Generated** — counts and timestamp after each run. |

## Regenerate cleaned + stratified outputs

From repo root:

```bash
node Knowledge/eval/scripts/build-golden-slices.cjs
```

Edit **non-derm** substrings and **stratification** heuristics in `build-golden-slices.cjs` as you refine the eval set.

## Cleaning rules (P1.2)

- **Dropped:** questions containing known **non-derm** substrings (shipping, megathread titles, etc.).
- **`query_style`:** `natural_language` vs `keyword_synthetic` (heuristic — short comma-stacked lines vs sentences).
- **`language`:** `en` vs `pt` vs `mixed_*` (heuristic).

## Stratification (P1.3)

Buckets are **heuristic** for offline eval balance; clinician review may relabel. See script for regex priorities (**vague titles** use **question-only** first so `ground_truth` does not override user intent bucket).

## Ground truth (P1.4)

`ground_truth` is an **editorial target** until a **frozen** slice is clinician-reviewed — see `../CLINICIAN_SPOT_CHECK.md`.
