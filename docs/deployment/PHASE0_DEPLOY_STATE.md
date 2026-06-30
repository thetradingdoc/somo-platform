# Phase 0 deploy state

Record prod vs git alignment after each deploy. Image tags use git short SHA per `scripts/deploy-to-gcp.sh`.

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

Map image tag (e.g. `gcr.io/somo-callsomo/somo-middleware:7768521`) → `git rev-parse --verify 7768521`.

## Exit gate

| Field | Value |
|-------|-------|
| Git `main` SHA | `1c55dc3` (voice scale + admin CRM merged PR #19/#20) |
| Deployed image tag | `gcr.io/somo-callsomo/somo-middleware:1c55dc3` |
| Cloud Run revision | `somo-middleware-00145-wlw` (2026-06-30 staging profile deploy) |
| `ci:phase0` at deploy | pass (local + deploy gate) |
| Voice scale | Interpretation A/B live; C capped (`voice_redis`: REDIS_URL missing) |
| Provision smoke | `npm run ci:phase0` includes `saas-tenant-provision`; live: `trial:provision-smoke` |

## PR #16

Do **not** merge `feat/middleware-monolith-layout` until Phase 0 exit (Jest purge conflicts with gate).
