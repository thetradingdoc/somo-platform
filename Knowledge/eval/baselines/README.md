# Regression baselines (Phase 1 — P1.5)

Snapshot JSON files from the **last offline eval run** (RAGAS + gap reports). Use them to **compare** after pipeline changes.

| File | Role |
|------|------|
| `ragas_results.json` | Aggregate faithfulness, answer relevancy, context precision/recall. |
| `accuracy_gap_report.json` | Specialty / concept mismatches per query variant. |
| `coverage_gap_report.json` | Cluster miss counts and example queries. |
| `synonym_gap_report.json` | Raw vs expanded query score lift. |

**How to use**

1. After a meaningful eval run, **copy** new reports here with a dated name if you want history, e.g. `ragas_results_2026-04-03.json`, and keep `ragas_results.json` as **current baseline**.
2. In CI or release notes, **diff** key metrics against the previous baseline.

**Note:** Files here are **point-in-time**; regenerate when you change the golden set or scorer.
