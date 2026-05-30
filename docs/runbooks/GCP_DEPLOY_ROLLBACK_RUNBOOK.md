# GCP deploy and rollback runbook

> **Last reviewed:** 2026-05-27

Production layout for **myskinandcare.com** (split-domain). Authoritative routing detail: [`docs/deployment/EDGE_ROUTING_CONFIGS.md`](../deployment/EDGE_ROUTING_CONFIGS.md).

## Architecture

| Role | Host | Platform |
|------|------|----------|
| Marketing SPA | `https://myskinandcare.com` | Firebase Hosting |
| Middleware API | `https://api.myskinandcare.com` | Google Cloud Run |

Landing builds must set `REACT_APP_API_BASE=https://api.myskinandcare.com` before `npm run build`.

## CI vs live deploy

- **CI:** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs tests on push/PR. **Staging deploy:** [`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml) (Cloud Run + Firebase). Railway is deprecated.
- **Operational source of truth:** Cloud Run `myskin-middleware` + Firebase Hosting + GCP Secret Manager.

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
cd unified-dashboard/somo-landing
REACT_APP_API_BASE=https://api.myskinandcare.com npm run build
# deploy via firebase deploy (project configured in unified-dashboard/firebase.json)
```

## Post-deploy smoke

From repo root:

```bash
npm run verify:prod:routing-smoke --prefix middleware-platform
```

Optional: `npm run test:prod:smoke --prefix middleware-platform` when `playwright.prod.config.cjs` exists.

### Voice smoke (recommended after voice-related deploys)

```bash
# Cloud Run liveness (startup probe path)
curl -sS -o /dev/null -w 'health_live:%{http_code}\n' https://api.myskinandcare.com/health/live

# Retell LLM HTTP probe
curl -sS -o /dev/null -w 'retell_llm:%{http_code}\n' https://api.myskinandcare.com/webhook/retell/llm

# Outbound (Twilio-direct path; requires .env with TWILIO_* and API_BASE_URL)
cd middleware-platform && node scripts/make-outbound-call.js 8622307479
```

Detail: [`docs/deployment/VOICE_CURRENT_ARCHITECTURE.md`](../deployment/VOICE_CURRENT_ARCHITECTURE.md).

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
| `429 Rate exceeded.` on `/health` or webhooks (body length 14, `server: Google Frontend`) | **Cloud Run scaling**, not app middleware. Log: `The request was aborted because there was no available instance` in `run.googleapis.com/requests`. Increase `min-instances`, lower `concurrency`, ensure startup probe `/health/live`, check revision crash/OOM. |
| Retell outbound `not_connected` + `telephony_provider_permission_denied` | **Retell↔Twilio SIP trunk auth** for `create-phone-call` path. Align termination URI + credential username/password in Retell with live Twilio SIP domain/trunk. Use Twilio-direct outbound (`make-outbound-call.js`) as operational workaround. See [`VOICE_CURRENT_ARCHITECTURE.md`](../deployment/VOICE_CURRENT_ARCHITECTURE.md). |
| Inbound connects but no agent / fallback TwiML | Check Cloud Run logs for Retell `register-phone-call` 400 (e.g. `merchant_id must be string`). Ensure dynamic variables are strings; omit null fields. |
| `error_llm_websocket_open` on Retell calls | Confirm agent `llm_websocket_url` = `wss://api.myskinandcare.com/webhook/retell/llm` and `RETELL_LLM_WEBSOCKET_URL` on Cloud Run; run `node configure-retell.js`. |
