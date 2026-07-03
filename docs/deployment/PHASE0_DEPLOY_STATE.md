# Phase 0 deploy state

Record prod vs git alignment after each deploy. Image tags use git short SHA per `scripts/deploy-to-gcp.sh`.

## Alignment note (2026-06-30 — pilot lifecycle + env gates)

| Layer | SHA / state |
|-------|-------------|
| **Production API** | `51f6fc5` — revision `somo-middleware-00155-s7x` |
| **Prior revision** | `somo-middleware-00154-hdt` (pilot env-only) |
| **GitHub `main`** | `51f6fc5` (pilot lifecycle `939c2db` + operator-sync fix) |

**Pilot prod env apply (2026-06-30):** `npm run setup:pilot-prod-env -- --apply` → revision `00154-hdt`, then full deploy → `00155-s7x`.

**Post-deploy fixes:** `callsomo-operator-sync.cjs` uses `MIDDLEWARE_API_BASE` in production; `verify:env-gates` supports `CLOUDRUN_VERIFY=1` for live Cloud Run HIPAA vars.

## Check current prod

```bash
gcloud run services describe somo-middleware \
  --region=us-central1 \
  --project=somo-callsomo \
  --format='yaml(status.latestReadyRevisionName,spec.template.spec.containers[0].image)'

gcloud run revisions list --service=somo-middleware \
  --region=us-central1 \
  --project=somo-callsomo \
  --limit=5
```

Map image tag (e.g. `gcr.io/somo-callsomo/somo-middleware:51f6fc5`) → `git rev-parse --verify 51f6fc5`.

## Exit gate

| Field | Value |
|-------|-------|
| Git `main` SHA (deployed) | `51f6fc5` |
| Deployed image tag | `gcr.io/somo-callsomo/somo-middleware:51f6fc5` |
| Cloud Run revision | `somo-middleware-00155-s7x` (2026-06-30 production deploy) |
| `ci:phase0` at deploy | pass |
| Post-deploy smoke | `verify:agent-config` pass; `smoke:staging` pass |
| Voice scale | Interpretation A/B live; C capped (`voice_redis`: REDIS_URL missing) |
| Front-desk gates (local) | `npm run verify:unblocked-phases` + `npm run verify:front-desk-pilot` before next deploy |
| Pilot prod readiness | `npm run verify:pilot-prod-readiness`; `PILOT_PROD_STRICT=1` when Stedi prod enrolled |
| Vendor blockers | Stedi prod enrollment + Dentrix API Exchange — `npm run verify:vendor-pending` |

## PR #16

Do **not** merge `feat/middleware-monolith-layout` until Phase 0 exit (Jest purge conflicts with gate).
