# Phase 0 deploy state

Record prod vs git alignment after each deploy. Image tags use git short SHA per `scripts/deploy-to-gcp.sh`.

## Alignment note (2026-07-02)

| Layer | SHA / state |
|-------|-------------|
| **Production API** | `1c55dc3` — voice scale readiness (see table below) |
| **GitHub `main`** | `b5ef272` — docs-only tip atop `1c55dc3` |
| **Local workspace** | `b5ef272` + uncommitted front-desk Batches 1–5 + audit fixes — **not deployed** |

After committing local work, run `npm run deploy:callsomo` and update this table with the new image tag and Cloud Run revision.

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
| Git `main` SHA (last deploy) | `1c55dc3` (voice scale + admin CRM merged PR #19/#20) |
| Git `main` SHA (tip, not deployed) | `b5ef272` (deploy sign-off docs) |
| Deployed image tag | `gcr.io/somo-callsomo/somo-middleware:1c55dc3` |
| Cloud Run revision | `somo-middleware-00145-wlw` (2026-06-30 staging profile deploy) |
| `ci:phase0` at deploy | pass (local + deploy gate) |
| Voice scale | Interpretation A/B live; C capped (`voice_redis`: REDIS_URL missing) |
| Provision smoke | `npm run ci:phase0` includes `saas-tenant-provision`; live: `trial:provision-smoke` |
| Front-desk gates (local) | `npm run verify:unblocked-phases` — run before next deploy |

## PR #16

Do **not** merge `feat/middleware-monolith-layout` until Phase 0 exit (Jest purge conflicts with gate).
