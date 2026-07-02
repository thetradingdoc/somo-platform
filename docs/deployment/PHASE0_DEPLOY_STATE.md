# Phase 0 deploy state

Record prod vs git alignment after each deploy. Image tags use git short SHA per `scripts/deploy-to-gcp.sh`.

## Alignment note (2026-07-02 — pilot prod env)

| Layer | SHA / state |
|-------|-------------|
| **Production API** | `eb78501` — revision `somo-middleware-00154-hdt` (PILOT_INVITE_ONLY + PILOT_RATE_LIMIT_ENABLED) |
| **Prior revision** | `somo-middleware-00153-fr5` |
| **GitHub `main`** | pending commit — pilot lifecycle + prod env automation |

**Pilot prod env apply (2026-07-02):** `npm run setup:pilot-prod-env -- --apply` → revision `00154-hdt`.

## Alignment note (2026-07-02)

| Layer | SHA / state |
|-------|-------------|
| **Production API** | `eb78501` — revision `somo-middleware-00153-fr5` |
| **GitHub `main`** | `eb78501` (includes PR #22 `6ecfe10` + deploy-state doc) |
| **Local workspace** | `eb78501` on `main` |

**Deploy completed (2026-07-02):** `npm run deploy:callsomo` from repo root. `ci:phase0` passed (225 Jest suites + voice routing smoke). Cloud Build image `gcr.io/somo-callsomo/somo-middleware:eb78501`. API health OK at `https://api.callsomo.com/health`. Post-deploy `smoke:staging` passed; `prod-routing-readiness-smoke` failed only `UI_ROOT_REDIRECT` (callsomo.com serves SPA 200 — expected in split-domain Firebase mode, not API regression).

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
| Git `main` SHA (deployed) | `eb78501` (PR #22 front-desk phases 0–5 + deploy-state doc) |
| Deployed image tag | `gcr.io/somo-callsomo/somo-middleware:eb78501` |
| Cloud Run revision | `somo-middleware-00153-fr5` (2026-07-02 production deploy) |
| `ci:phase0` at deploy | pass (2026-07-02) |
| Post-deploy smoke | `smoke:staging` pass; `UI_ROOT_REDIRECT` fail (benign — Firebase SPA) |
| Voice scale | Interpretation A/B live; C capped (`voice_redis`: REDIS_URL missing) |
| Provision smoke | `npm run ci:phase0` includes `saas-tenant-provision`; live: `trial:provision-smoke` |
| Front-desk gates (local) | `npm run verify:unblocked-phases` + `npm run verify:front-desk-pilot` before next deploy |
| Pilot prod readiness | `npm run verify:pilot-prod-readiness`; `PILOT_PROD_STRICT=1` when Stedi prod enrolled |

## PR #16

Do **not** merge `feat/middleware-monolith-layout` until Phase 0 exit (Jest purge conflicts with gate).
