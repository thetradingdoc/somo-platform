# Tenant matrix — voice × specialty × payer (AD-05)

**Status:** Engineering complete — **operator/clinical sign-off pending** (AD-08 / F-09)  
**Last updated:** 2026-07-11

| Clinic ID | Vertical | Specialty | Triage policy | Admin coding path | Payer seeds | PSTN | Starter set / notes |
|-----------|----------|-----------|---------------|-------------------|-------------|------|---------------------|
| clinic-a | dental_office | Dental (general) | disabled | CDT phrase-map + `resolveAdminInsuranceCodes` | Delta Dental NY, Aetna Dental, MetLife Dental, Cigna Dental | yes | MT-08 fixture — D1110 cleaning default, D9310 ortho consult, D3310 endo |
| clinic-b | healthcare_clinic | Primary care (`healthcare_clinic`) | disabled | `CLINIC_TRIGGER_MAP` E/M + wellness (99395, G0438, 99391) | BCBS NY, Aetna, UHC | yes | MT-08 fixture — 99213 telehealth default, 90791 psych intake override |
| somo-pilot | healthcare_clinic | Derm pilot | enabled | Dual-source RAG + triage | BCBS | yes | F-09 C-P0-03 — conditional RAG per AD-01 |
| littlelab | beauty | N/A | N/A | N/A | N/A | no | Global Pinecone warmup only |

## Plan-rules coverage (PY-01)

| Visit type | BCBS | Aetna | UHC | Delta Dental | MetLife Dental | Notes |
|------------|------|-------|-----|--------------|----------------|-------|
| New E/M (99203) | $40 | $45 | $50 | N/A | N/A | `plan-rules-benefits-scale.json` |
| Est E/M (99213) | $25 | $30 | $35 | N/A | N/A | |
| MH (90834) | $30 | $35 | $40 | N/A | N/A | |
| Wellness (G0438) | $0 | $0 | $0 | N/A | N/A | |
| Dental cleaning (D1110) | N/A | N/A | N/A | $0 | N/A | |
| Dental endo (D3310) | N/A | N/A | N/A | $150 | N/A | |
| Dental perio (D4341) | N/A | N/A | N/A | N/A | N/A | Aetna Dental $75 |
| Dental ortho (D8080) | N/A | N/A | N/A | N/A | $35 | |

See [`COVERAGE_MATRIX.md`](./COVERAGE_MATRIX.md) for refreshed patient-facing grid.

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product owner | Jay | | |
| Clinical lead | *assign CF-OP-8* | | |
| Engineering | | 2026-07-11 | Eng matrix + starter sets complete |

See [AD-01_HEALTHCARE_CLINIC_RAG_ADR.md](./AD-01_HEALTHCARE_CLINIC_RAG_ADR.md) for conditional RAG policy.
