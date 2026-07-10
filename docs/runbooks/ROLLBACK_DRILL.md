# Rollback drill runbook (Phase 7.6 — CR-065)

Target: **complete Cloud Run rollback + smoke in under 15 minutes**.

## Prerequisites

- `gcloud` authenticated with deploy permissions
- `GCP_PROJECT`, `GCP_REGION`, `CLOUDRUN_SERVICE` (or defaults from `scripts/lib/cloudrun-deploy-env.sh`)

## Drill steps

| Step | Action | Target time |
|------|--------|-------------|
| 1 | Note current revision: `gcloud run revisions list --limit 3` | 1 min |
| 2 | Run rollback: `bash scripts/rollback-gcp-release.sh` | 3 min |
| 3 | Smoke: `npm run verify:prod:routing-smoke --prefix middleware-platform` | 2 min |
| 4 | Kelly env: `npm run verify:kelly-rails-cloudrun --prefix middleware-platform` | 2 min |
| 5 | Portal spot-check: `https://callsomo.com/business/today.html` | 1 min |
| 6 | API health: `https://api.callsomo.com/health` | 1 min |

**Total budget:** 10 minutes (+ 5 min buffer)

## Dry-run (no traffic shift)

```bash
cd middleware-platform
node scripts/rollback-drill.cjs --dry-run
```

Records checklist and timestamps without calling `gcloud`.

## Live drill

```bash
# Operator only — shifts production traffic
bash scripts/rollback-gcp-release.sh
```

Log actual elapsed time to `PRODUCTION_PLAN_LOG.md` task 7.6.

## Rollback script

`scripts/rollback-gcp-release.sh` routes 100% traffic to the previous Cloud Run revision, then runs `verify:prod:routing-smoke`.

## Failure recovery

If smoke fails after rollback:

1. Re-route to known-good revision: `gcloud run services update-traffic SERVICE --to-revisions=REVISION=100`
2. File incident with failed check ID from smoke output
3. Do not re-deploy until root cause is identified

**Requires live prod access:** steps 2–6 of live drill.
