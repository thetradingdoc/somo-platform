# Knowledge assets index

> **Last reviewed:** 2026-05-25
> Medical coding architecture and operations are canonical in [`docs/Medical Coding/`](../Medical%20Coding/README.md).

This page is now an index to the `Knowledge/` asset tree only.

## Canonical medical coding docs

- [`docs/Medical Coding/ARCHITECTURE.md`](../Medical%20Coding/ARCHITECTURE.md)
- [`docs/Medical Coding/OPERATIONS.md`](../Medical%20Coding/OPERATIONS.md)
- [`docs/deployment/MEDICAL_CODEBOOK_SETUP.md`](../deployment/MEDICAL_CODEBOOK_SETUP.md)

## Knowledge directory map (assets, not architecture)

| Area | Path | Notes |
|------|------|-------|
| Coding and triage rules | `Knowledge/rules/` | `code-pair-validation.json`, `triage-rules.json`, `lay-language-icd-expansions.json` |
| Medical ontology | `Knowledge/ontology/` | abbreviations, entities, extraction patterns |
| RAG support assets | `Knowledge/RAG/` | corrections, terminology maps, optional Flask helpers |
| Fee schedules | `Knowledge/fee-schedules/` | MPFS CSV (`PPRRVU.csv`) and notes |

## Important

- Do **not** use this file for CPT/ICD row counts or import defaults.
- For imports/eval/prod parity, use [`OPERATIONS.md`](../Medical%20Coding/OPERATIONS.md).
