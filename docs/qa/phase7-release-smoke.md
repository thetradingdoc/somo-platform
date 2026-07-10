# Phase 7.8 — Release smoke suite

Automatable pre-release gate covering global-definition steps 1–8 (structural + HTTP replay).

## Command

```bash
cd middleware-platform
npm run phase7:release-smoke
```

Skip portal gates when middleware-only:

```bash
PHASE7_SKIP_PORTAL=1 npm run phase7:release-smoke
```

## What runs

| Step | Script | Live prod? |
|------|--------|------------|
| Scenario matrix | `verify-pilot-scenario-matrix.cjs` | No |
| Vertical PSTN structural | `vertical-pstn-scenarios.cjs` | No |
| Postgres/GCS reconciliation | `verify-postgres-gcs-reconciliation.cjs` | Optional (`--pull`) |
| Postgres mirror lag | `verify-postgres-mirror-lag.cjs` | Optional (`POSTGRES_URL`) |
| Dental HTTP replay | `dental-pstn-scenarios.cjs` | No |
| Kelly Rails env profile | `verify-phase7-kelly-rails-deploy.cjs` | Cloud Run optional |
| Portal e2e gates | `portal-e2e-run.cjs --step=gates` | Staging/prod env |

## Live PSTN + payment

Full PSTN and payment proof still requires operator execution — see `docs/qa/pstn-vertical-matrix.md` and acceptance test steps 1–8 in the production plan.
