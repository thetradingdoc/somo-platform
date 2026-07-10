# Portal E2E — ship-when checklist

## Initial pilot readiness (one-time)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Phase 1: 3 accounts + junk removed + doclittle archived | **DONE** (2026-07-04) |
| 2 | GCS prod DB uploaded after cleanup | **DONE** |
| 3 | `did-bind-verify` for Somo `customer_id` on `+18623622415` | **PENDING** (still doclittle until Somo create) |
| 4 | `somo-create-state.json` → `complete` | **PENDING** |
| 5 | All P0 pass prod `reuse` | **PENDING** (needs `PW_SOMO_PROD_*`) |
| 6 | Zero P0 regressions (Kelly pause, session 401, kill switch) | **PENDING** |
| 7 | Zero prod-only P0 in parity table | **PENDING** |
| 8 | Compliance doc signed | **DONE** |
| 9 | CI post-deploy prod P0 green once | **PENDING** (wire secrets + first run) |
| 10 | PSTN manual smoke | **PENDING** — see `portal-e2e-pstn-smoke.md` |

## Ongoing gate (production-grade)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Post-deploy prod P0 blocking | Wired in `.github/workflows/portal-e2e-gate.yml` |
| 2 | P0 pass rate ≥ 95% over 14 nightly runs | Pending first nightly history |
| 3 | P1 coverage all controls within 14 runs | Tracker in `portal-e2e-history.jsonl` |
| 4 | Somo e2e cleanup job green | `portal-e2e-cleanup-somo.cjs` weekly dry-run in CI |

## Commands

```bash
# Full orchestrator
npm run portal-e2e:run --prefix middleware-platform -- --step=all --continue-on-fail

# After Somo signup (manual browser once):
PORTAL_E2E_SOMO_CUSTOMER_ID=cust_xxx npm run portal-e2e:somo-bind --prefix middleware-platform

# Prod reuse gate
PW_SOMO_PROD_EMAIL=... PW_SOMO_PROD_PASS=... npm run test:e2e:portal:prod-reuse --prefix middleware-platform
```
