# GCP deploy and rollback runbook

> **Last reviewed:** 2026-05-25

Production layout for **myskinandcare.com** (split-domain). Authoritative routing detail: [`docs/deployment/EDGE_ROUTING_CONFIGS.md`](../deployment/EDGE_ROUTING_CONFIGS.md).

## Architecture

| Role | Host | Platform |
|------|------|----------|
| Marketing SPA | `https://myskinandcare.com` | Firebase Hosting |
| Middleware API | `https://api.myskinandcare.com` | Google Cloud Run |

Landing builds must set `REACT_APP_API_BASE=https://api.myskinandcare.com` before `npm run build`.

## CI vs live deploy

- **CI:** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs tests on push/PR. The **Deploy to Railway** job is a **placeholder** (prints success; Railway may auto-deploy on push).
- **Operational source of truth:** your Cloud Run service + Firebase Hosting project + env vars in those consoles (and any Railway host if still in use for API).

See [deployment README § CI and deployment](../deployment/README.md#ci-and-deploy-source-of-truth).

## Pre-deploy checklist

1. PR passes CI (`CONTRIBUTING.md` local parity).
2. Medical codebook on prod host if coding release: [`PROD_DB_PARITY.md`](../deployment/PROD_DB_PARITY.md), `npm run verify:prod-codebook`.
3. Env vars per [`ENVIRONMENT_VARIABLES_BY_SURFACE.md`](../setup/ENVIRONMENT_VARIABLES_BY_SURFACE.md) and [`RENDER_PRODUCTION_CHECKLIST.md`](../deployment/RENDER_PRODUCTION_CHECKLIST.md) (Stedi, Pinecone, `RAG_API_URL=disabled`).

## Deploy (typical)

### API (Cloud Run)

1. Build and push container (team-specific pipeline; see infra docs in repo root).
2. Deploy new revision to Cloud Run service backing `api.myskinandcare.com`.
3. Verify:

```bash
curl -sS -i https://api.myskinandcare.com/health
```

### Landing (Firebase Hosting)

```bash
cd unified-dashboard/littlelab-landing
REACT_APP_API_BASE=https://api.myskinandcare.com npm run build
# deploy via firebase deploy (project configured in unified-dashboard/firebase.json)
```

## Post-deploy smoke

From repo root:

```bash
npm run verify:prod:routing-smoke --prefix middleware-platform
```

Optional: `npm run test:prod:smoke --prefix middleware-platform` when `playwright.prod.config.cjs` exists.

## Rollback

### Cloud Run

1. Open Cloud Run → service → **Revisions**.
2. Route 100% traffic to the **previous healthy revision**.
3. Re-run `/health` and routing smoke.

### Firebase Hosting

1. Hosting → **Release history** → roll back to prior release.
2. Confirm SPA loads and API calls hit `api.myskinandcare.com` (not marketing host `/api/*` — that returns HTML by design on split-domain).

## When things go wrong

| Symptom | Check |
|---------|--------|
| `/api/*` on marketing domain returns HTML | Expected on split-domain; fix client `REACT_APP_API_BASE` |
| Coding regressions | [`Medical Coding/OPERATIONS.md`](../Medical%20Coding/OPERATIONS.md) — eval + codebook verify |
| Stedi claims stuck | [`runbooks/STEDI_DOWN`](./README.md#stedi-down) anchor in consolidated runbooks |
