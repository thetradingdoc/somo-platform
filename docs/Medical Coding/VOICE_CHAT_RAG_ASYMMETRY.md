# Voice vs Chat RAG Asymmetry (CP-03)

**Status:** Documented for F-09 Appendix C review (C-P0-06)  
**Last updated:** 2026-07-10

## Summary

Kelly **voice** and **chat** paths share the same coding SSOT (`select-primary-codes.js`, `resolve-insurance-codes.js`) but differ in **when** full triage RAG runs and **which tools** are exposed mid-conversation.

| Dimension | Voice (PSTN / Retell) | Chat (orchestrator / portal) |
|-----------|----------------------|------------------------------|
| Primary ranking SSOT | `run_triage_rag` → `select-primary-codes` | `suggest_codes_from_symptoms` → same SSOT via `visit-codes-service` |
| OPQRST capture | `store_triage_opqrst` + rich intake gates | OPQRST steps in orchestrator; partial ICD hint before lane choice |
| Tool firewall | `mode-tool-firewall.js` blocks coding in demo/sales modes | Same firewall via Kelly rails |
| Confidence / HITL | `CODING_CONFIDENCE_THRESHOLD` 0.65 on collect spine | Same threshold; chat may defer collect until lane selected |
| Latency budget | `REMOTE_RAG_TIMEOUT_MS` 8000 on voice | Chat tolerates longer RAG; no hard PSTN timeout |

## Accepted tradeoffs (pending clinical sign-off)

1. **Voice runs full spine before collect** — chat may surface a single ICD hint earlier without full CPT ranking.
2. **Telehealth E/M boost** applies on both paths when `telehealthIntent` is set on voice collect; chat orchestrator does not always pass telehealth flag on early OPQRST hint.
3. **Pinecone tenant filter** applies when `clinicId` is present on both paths; global-only warmup vectors remain LittleLab-only.

## F-09 review prompt (C-P0-06)

Clinical lead should confirm whether early chat ICD hints without ranked CPT are acceptable for patient-facing copy, or whether chat must call `run_triage_rag` before any code suggestion.

**Sign-off:** See [KELLY_CODING_MASTER_EXECUTION_PLAN.md](./KELLY_CODING_MASTER_EXECUTION_PLAN.md) Appendix C.
