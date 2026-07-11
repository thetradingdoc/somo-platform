# F-09 Appendix C — Engineering attestation (pre-clinical sign-off)

**Date:** 2026-07-11  
**Purpose:** Eng verification for C-P0-01..07 before clinical lead signatures (CF-OP-5).

| ID | Item | Eng status | Evidence |
|----|------|------------|----------|
| C-P0-01 | OPQRST → `triage_rag_results` columns | **verified** | `verify-opqrst-column-registry.cjs`; `config/clinical-opqrst/en.json` store_field map |
| C-P0-02 | Red-flag escalation paths | **ready for clinical** | `triage-service.js` detectRedFlags; eval `voice_emergency` category |
| C-P0-03 | Derm pilot specialty routing | **verified** | `specialty-ranking-cp09.test.js`; tenant matrix somo-pilot row |
| C-P0-04 | CAGE cap HITL at 0.65 | **verified** | `CODING_CONFIDENCE_THRESHOLD=0.65`; `verify-coding-hitl.cjs` |
| C-P0-05 | Preventive spine codes | **verified** | `preventive-spine.test.js`; G0438 via `select-primary-codes` |
| C-P0-06 | Voice vs chat RAG asymmetry | **documented** | [`VOICE_CHAT_RAG_ASYMMETRY.md`](../Medical%20Coding/VOICE_CHAT_RAG_ASYMMETRY.md) |
| C-P0-07 | Production tenant matrix | **draft** | [`TENANT_MATRIX.md`](../Medical%20Coding/TENANT_MATRIX.md) — clinical signature pending |

## Clinical sign-off (pending CF-OP-5 / CF-OP-8)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Clinical lead | *assign in KELLY_F09_GOVERNANCE.md* | | |
| Product owner | Jay | | |

**Handoff:** [`KELLY_F09_GOVERNANCE.md`](../../docs/clinical/KELLY_F09_GOVERNANCE.md) · Master plan [Appendix C](./KELLY_CODING_MASTER_EXECUTION_PLAN.md#appendix-c--f-09-kelly-phase-c-clinical-sign-off)
