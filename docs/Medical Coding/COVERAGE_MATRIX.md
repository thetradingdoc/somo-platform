# Coverage matrix (patient-facing copay grid)

**Status:** Populated by PY-01 ingest — refreshed 2026-07-11

**SSOT:** This file, refreshed on each `plan_rules` ingest via `scripts/refresh-coverage-matrix.cjs`.

| Visit type | BCBS | Aetna | UHC | Delta Dental | Notes |
|------------|------|-------|-----|--------------|-------|
| New E/M | $40 | $45 | $50 | N/A | plan_rules |
| Est E/M | $25 | $30 | $35 | N/A | plan_rules |
| MH (90834) | $30 | $35 | $40 | N/A | plan_rules |
| Wellness | $0 | $0 | $0 | N/A | plan_rules |
| Dental (CDT) | N/A | N/A | N/A | $0 | plan_rules |

*Regenerate: `npm run refresh:coverage-matrix`*
