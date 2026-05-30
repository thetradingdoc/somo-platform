# Staging on myskinandcare.com

> **Last reviewed:** 2026-05-29  
> Use **myskinandcare.com** as staging before Somo-branded DNS. **Local** stays on `localhost:4000` + ngrok.

## Two-tier model

| Tier | UI | API | DB |
|------|-----|-----|-----|
| **Local** | `http://localhost:4000` / `:5180` | same (+ ngrok for voice) | `middleware-dev.db` |
| **Staging** | `https://myskinandcare.com` | `https://api.myskinandcare.com` | Cloud Run SQLite/Postgres |

Split-domain layout: [`EDGE_ROUTING_CONFIGS.md`](./EDGE_ROUTING_CONFIGS.md)

---

## What ships to Firebase (UI host)

The staging bundle includes:

- Somo landing SPA (`/`)
- Provider signup (`/signup`) and login (`/login`)
- Business portal (`/business/*`)
- Shared assets (`/assets`, `/unified-dashboard/assets`)

Build:

```bash
npm run build:staging-hosting
# → unified-dashboard/hosting-dist/
```

Deploy:

```bash
npm run deploy:staging-hosting
```

This replaces landing-only deploy. `firebase.json` rewrites `/signup` → `signup.html` before the SPA catch-all.

---

## API calls from the marketing host

Portal pages on `myskinandcare.com` call **`https://api.myskinandcare.com`** (not same-origin `/api`):

- [`unified-dashboard/assets/js/config.js`](../unified-dashboard/assets/js/config.js)
- [`unified-dashboard/assets/js/api-base.js`](../unified-dashboard/assets/js/api-base.js) — used by signup/login/voice

Cookies use `domain=.myskinandcare.com` (see `signup.js` / `server.js`).

Landing demo uses `VITE_API_BASE=https://api.myskinandcare.com` in `somo-landing/.env.production`.

---

## Cloud Run (API) env

Set on **`api.myskinandcare.com`** service — see [`STAGING_TRIAL_ROLLOUT.md`](./STAGING_TRIAL_ROLLOUT.md):

```bash
API_BASE_URL=https://api.myskinandcare.com
BASE_URL=https://api.myskinandcare.com
TRIAL_SIM_FLOW_ENABLED=1
TWILIO_*  RETELL_*  STRIPE_*  SMTP_*
SOMO_OWNER_EMAIL=drlittlekids@gmail.com
```

Bootstrap owner **on staging DB** (not local):

```bash
# Run against staging Cloud Run job / shell with staging DB_PATH
npm run ensure:somo-owner
PUBLIC_BASE_URL=https://api.myskinandcare.com \
node scripts/attach-existing-twilio-number.cjs \
  --customer-id=<OWNER_ID> --phone=+1... --twilio-sid=PN... --update-webhook
```

Voice webhook (staging):

`https://api.myskinandcare.com/voice/incoming?customer_id=<OWNER_ID>`

No ngrok on staging.

---

## Deploy order

**One command (API + UI + smoke):**

```bash
./scripts/deploy-staging-all.sh
```

Or step-by-step:

1. **Secrets (once):** `./scripts/provision-staging-secrets.sh` → GCP Secret Manager
2. **API:** `USE_GCP_SECRETS=1 ./scripts/deploy-to-gcp.sh` — see [`STAGING_CLOUDSQL.md`](./STAGING_CLOUDSQL.md)
3. **UI:** `npm run deploy:staging-hosting`
4. **Bootstrap (once on staging DB):** `./scripts/deploy-staging-bootstrap-job.sh` or `npm run bootstrap:staging --prefix middleware-platform`
5. **Smoke:**

```bash
npm run smoke:staging
STAGING=1 npm run gate:week1:staging --prefix middleware-platform
```

6. **Sign-off:** [`STAGING_SIGNOFF.md`](./STAGING_SIGNOFF.md)

**CI:** `.github/workflows/deploy-staging.yml` (manual dispatch or push to `main`).

**Rollback:** `./scripts/rollback-gcp-release.sh` — see [`STAGING_OBSERVABILITY.md`](./STAGING_OBSERVABILITY.md)

---

## Optional: same-domain `/api` proxy (Cloudflare)

If you want `https://myskinandcare.com/api/*` to hit Cloud Run (instead of cross-origin API calls):

- Deploy [`infra/edge-routing/cloudflare/myskin-api-proxy/`](../infra/edge-routing/cloudflare/myskin-api-proxy/)
- Route: `myskinandcare.com/api/*`, `/voice/*`, `/webhooks/*`

Default staging path uses **split-domain API** (no worker required).

---

## Local vs staging checklist

| Check | Local | Staging |
|-------|-------|---------|
| Signup wizard | http://localhost:4000/signup | https://myskinandcare.com/signup |
| Login | http://localhost:4000/login | https://myskinandcare.com/login |
| Agent UI | /business/agent.html | same path on myskinandcare.com |
| Week 1 gate | `npm run gate:week1` | `STAGING=1 npm run gate:week1:staging` |
| Trial E2E | `npm run test:e2e:trial` (local API) | Manual + `STAGING_TRIAL_ROLLOUT.md` smoke |

---

## Somo DNS (later)

When Somo production DNS is ready, reuse this split-domain pattern:

- Marketing → Firebase or CDN
- API → Cloud Run
- Same `api-base.js` / `config.js` pattern with new hostnames
