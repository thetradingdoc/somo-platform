# Phase 0 deploy state

Record prod vs git alignment after each deploy. Image tags use git short SHA per `scripts/deploy-to-gcp.sh`.

## Alignment note (2026-07-02)

| Layer | SHA / state |
|-------|-------------|
| **Production API** | `1c55dc3` — voice scale readiness (not yet updated) |
| **GitHub `main`** | `6ecfe10` — PR #22 front-desk phases 0–5 merged |
| **Local workspace** | `6ecfe10` on `main` — synced with GitHub |

**Deploy status (2026-07-02):** PR [#22](https://github.com/richiejeremiah/somo-platform/pull/22) merged; `ci:phase0` passed locally during `npm run deploy:callsomo`. Deploy **blocked** — Firebase credentials expired (`firebase login --reauth`) and gcloud token refresh failed (`gcloud auth login`). Production unchanged until auth refresh + redeploy.

After re-auth, run `npm run deploy:callsomo` and update this table with the new image tag and Cloud Run revision.

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
| Git `main` SHA (tip, not deployed) | `6ecfe10` (PR #22 front-desk phases 0–5) |
| Deployed image tag | `gcr.io/somo-callsomo/somo-middleware:1c55dc3` |
| Cloud Run revision | `somo-middleware-00145-wlw` (2026-06-30 staging profile deploy) |
| `ci:phase0` at deploy attempt | pass (2026-07-02, pre-Firebase deploy) |
| Deploy blocker | Firebase + gcloud auth expired — run `firebase login --reauth` and `gcloud auth login` |
| Voice scale | Interpretation A/B live; C capped (`voice_redis`: REDIS_URL missing) |
| Provision smoke | `npm run ci:phase0` includes `saas-tenant-provision`; live: `trial:provision-smoke` |
| Front-desk gates (local) | `npm run verify:unblocked-phases` — run before next deploy |

## PR #16

Do **not** merge `feat/middleware-monolith-layout` until Phase 0 exit (Jest purge conflicts with gate).
