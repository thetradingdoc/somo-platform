# Clinician spot-check — golden `ground_truth` (Phase 1 — P1.4)

## Purpose

`ground_truth` text in `datasets/golden_dataset.json` is **not** automatically medically verified. Before treating a slice as **frozen** for safety regression tests, a **clinician** should sample and sign off.

## Suggested process

1. **Stratified sample:** Use `golden_stratified_slice_v1.json` or draw **n ≥ 20** with at least:
   - **10** from `high_risk` / malignancy-adjacent buckets  
   - **5** from `vague_or_worried`  
   - **5** from `routine_product` / `keyword_synthetic`

2. **Per row, record:**
   - [ ] **Safe for patient-facing education** (Y/N/Edit)
   - [ ] **Tone** appropriate (non-diagnostic where needed)
   - [ ] **Escalation** language adequate for red-flag topics
   - Notes / suggested rewrite (optional)

3. **Outcome:**
   - **Pass:** mark slice version `golden_v1_clinician_ok` with date + reviewer role.
   - **Fail:** remove or rewrite rows; re-export JSON; bump version.

## Template (copy to spreadsheet)

| post_id | question (short) | bucket | safe Y/N | notes |
|---------|------------------|--------|----------|-------|
| | | | | |

---

*Legal/clinical ownership: your organization’s clinical governance, not engineering.*
