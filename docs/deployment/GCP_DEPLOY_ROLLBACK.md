# GCP deploy and rollback

Completes open items from [`CLEAN_PUSH_GCP_TODOS.md`](../../todos/pending/CLEAN_PUSH_GCP_TODOS.md).

## Pre-deploy

```bash
git status   # post-commit cleanliness
cd middleware-platform && npm test
npm run staging:preflight   # when targeting staging
```

Record **prior SHA**: `git rev-parse HEAD~1`

## Deploy path

1. **Code:** push to `main` → Cloud Run via workflow or `gcloud run deploy`.
2. **Hosting:** `node scripts/build-staging-hosting.cjs` + Firebase/GCS hosting deploy.

Choose one or both per release scope.

## Post-deploy smoke

```bash
curl -sf "$MIDDLEWARE_API_BASE/health"
curl -sf "$MIDDLEWARE_API_BASE/api/health" || true
# Payor public route sample
cd middleware-platform && npm run verify:prod:routing-smoke
```

Critical UI: provider login → Today → voice settings GET.

## Rollback

```bash
# Cloud Run — redeploy previous revision or image tag
gcloud run services update-traffic SERVICE --to-revisions=PREVIOUS_REVISION=100

# Git revert (if needed)
git revert <bad-sha> --no-edit
```

Document rollback SHA and time in release notes.
