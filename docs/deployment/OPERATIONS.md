# OPERATIONS

**Last updated:** 2026-06-02


---

<a id="somo-cloud-run-deploy"></a>

## SOMO CLOUD RUN DEPLOY

*Merged from `docs/deployment/SOMO_CLOUD_RUN_DEPLOY.md` on 2026-06-02.*

# Somo Cloud Run deploy (single source of truth)

Last updated: 2026-06-02

## Service naming

| Symbol | Value |
|---|---|
| GCP project | `somo-callsomo` |
| Region | `us-central1` |
| Cloud Run service | **`somo-middleware`** |
| Public API host | `https://api.callsomo.com` |

Constants: [scripts/lib/cloudrun-deploy-env.sh](../../scripts/lib/cloudrun-deploy-env.sh)

## Deploy commands

### Staging

```bash
CLOUDRUN_PROFILE=staging USE_GCP_SECRETS=1 ./scripts/deploy-to-gcp.sh
```

### Production

```bash
gcloud auth login
gcloud config set project somo-callsomo
./scripts/deploy-to-gcp-production.sh
```

Production deploy preserves existing service env vars (image-only) and targets whichever Cloud Run service owns `api.callsomo.com`. Remap the domain to **`somo-middleware`** when ready: [GCP_SOMO_SERVICE_CUTOVER.md](GCP_SOMO_SERVICE_CUTOVER.md).

## Post-deploy verification

```bash
curl -i https://api.callsomo.com/api/public/somo-demo/health
curl -i -X POST https://api.callsomo.com/api/public/landing-assistant/turn \
  -H 'content-type: application/json' \
  -d '{"session_id":"smoke","message":"hello"}'
npm run verify:prod:routing-smoke --prefix middleware-platform
npm run test:prod:smoke --prefix middleware-platform
```

## Somo demo secrets

Prefer `SOMO_DEMO_*` in Secret Manager / `.env`. Legacy `DODGECALL_*` values are read via [somo-demo-env.js](../../middleware-platform/lib/somo-demo-env.js).

## Kelly rails (production profile)

Set via `generate-cloudrun-env-yaml.cjs` when `CLOUDRUN_PROFILE=production`:

- `KELLY_RAILS_V2=1`
- `KELLY_RAILS_ROLLOUT_PCT=1`
- `KELLY_ALLOW_HYBRID_GRAPH=0`


---

<a id="gcp-somo-service-cutover"></a>

## GCP SOMO SERVICE CUTOVER

*Merged from `docs/deployment/GCP_SOMO_SERVICE_CUTOVER.md` on 2026-06-02.*

# GCP cutover: Somo Cloud Run service

Remap `api.callsomo.com` to **`somo-middleware`** (Somo API on Cloud Run).

**Status (2026-06-02):** Cutover complete. Domain maps to `somo-middleware`. Legacy service `myskin-middleware` decommissioned.

## Preconditions

- `gcloud auth login`
- Project `somo-callsomo`, region `us-central1`

## 1) Audit

```bash
gcloud config set project somo-callsomo
gcloud beta run domain-mappings list --platform managed --region us-central1
gcloud run services describe somo-middleware --region us-central1 --format="yaml(spec.traffic)" 2>/dev/null || true
```

## 2) Bootstrap `somo-middleware` (first-time only)

If `somo-middleware` does not exist, clone env from the live service before remapping DNS:

```bash
gcloud run services describe myskin-middleware \
  --region us-central1 --project somo-callsomo --format export > /tmp/somo-middleware.yaml
# Edit metadata.name to somo-middleware; remove status/resourceVersion/uid/generation
gcloud run services replace /tmp/somo-middleware.yaml --region us-central1 --project somo-callsomo

CLOUDRUN_SERVICE_SET=1 CLOUDRUN_SERVICE=somo-middleware ./scripts/deploy-to-gcp-production.sh
```

Smoke the direct URL before remapping DNS:

```bash
SOMO_URL=$(gcloud run services describe somo-middleware --region us-central1 --format='value(status.url)')
curl -sS "$SOMO_URL/api/public/somo-demo/health"
```

## 3) Deploy production

```bash
./scripts/deploy-to-gcp-production.sh
```

Targets the service that owns `api.callsomo.com` (auto-detected). After cutover, that is `somo-middleware`.

## 4) Point domain at somo-middleware

```bash
gcloud beta run domain-mappings delete --domain=api.callsomo.com \
  --region=us-central1 --project=somo-callsomo --quiet

gcloud beta run domain-mappings create \
  --service somo-middleware \
  --domain api.callsomo.com \
  --region us-central1
```

## 5) Route 100% traffic to latest revision

```bash
REV=$(gcloud run revisions list --service somo-middleware --region us-central1 --format='value(name)' --limit=1)
gcloud run services update-traffic somo-middleware \
  --region us-central1 \
  --to-revisions="${REV}=100"
```

## 6) Verify

```bash
gcloud beta run domain-mappings describe --domain api.callsomo.com \
  --region us-central1 --format='value(spec.routeName)'

curl -sS https://api.callsomo.com/api/public/somo-demo/health
curl -sS -X POST https://api.callsomo.com/api/public/landing-assistant/turn \
  -H 'content-type: application/json' \
  -d '{"session_id":"cutover","message":"hello"}'

npm run verify:prod:routing-smoke --prefix middleware-platform
npm run test:prod:smoke --prefix middleware-platform
```

Expect `spec.routeName` = `somo-middleware`, somo-demo health `200`, landing turn `200`.

## 7) Decommission legacy Cloud Run service

After `somo-middleware` is stable on the public domain (24–48h optional soak):

```bash
gcloud beta run domain-mappings describe --domain=api.callsomo.com \
  --region=us-central1 --format='value(spec.routeName)'
# must be somo-middleware

gcloud run services delete myskin-middleware \
  --region=us-central1 --project=somo-callsomo --quiet
```

Optional: remove unused container images `gcr.io/somo-callsomo/myskin-middleware:*` in Artifact Registry when no longer referenced.


---

<a id="somo-landing"></a>

## SOMO LANDING

*Merged from `docs/deployment/SOMO_LANDING.md` on 2026-06-02.*

# Somo landing

**Last Updated:** 2026-05-30

Single marketing SPA for **Somo** — voice demo + provider signup CTA.

## Hero UI

See [SOMO_LANDING_HERO.md](./SOMO_LANDING_HERO.md) for hero structure, assets, breakpoints, and copy.

## Signup handoff

CTAs use `VITE_SIGNUP_URL` or `/signup?utm_source=somo`. The signup wizard ([signup.html](../../unified-dashboard/signup.html)) shares marketing tokens (white background, League Spartan, Image 1 Green Lizard `#b5e930`). Palette and component mapping: [SOMO_MARKETING_COLORS.md](../design/SOMO_MARKETING_COLORS.md). After a live demo, name/phone/use case are prefilled via `sessionStorage` key `somo_signup_prefill`. Flow details: [PROVIDER_SIGNUP_FLOW.md](./PROVIDER_SIGNUP_FLOW.md).

## Repos / paths

| Piece | Path |
|-------|------|
| Landing (Vite + React) | `unified-dashboard/somo-landing/` |
| Public demo API | `POST /api/public/somo-demo/request-call` |
| Service | `middleware-platform/services/somo-demo-service.js` |
| Telephony | `call_type=somo_demo` on `/voice/incoming` |
| Archived legacy landing | `unified-dashboard/_archive/littlelab-landing/` |

## Hosts

| Host | Serves |
|------|--------|
| `https://callsomo.com` | Somo landing (Firebase Hosting → `somo-landing/build`) |
| `http://localhost:4000/` | Somo landing (middleware, local dev) |
| `https://api.callsomo.com` | Middleware API only |

Legacy marketing paths (`/shop`, `/landing`, `/find-provider`, etc.) redirect to `/`.

## Local dev

### Fast profile (recommended)

Heavy background workers and catalog sync block the Node event loop on large local SQLite files. Use the light profile when working on the landing:

```bash
cd middleware-platform
export DB_PATH=./middleware-dev.db
export DEV_LIGHT_START=1
export CATALOG_MASTER_SYNC_ENABLED=0
export EHR_SYNC_ENABLED=0
npm start
```

Or from repo root: `npm run start:landing --prefix middleware-platform`

Open **http://localhost:4000/** — Somo hero + “Try Our Live Demo”.

### Fast UI iteration (Vite HMR)

```bash
# Terminal 1 — API (light profile)
npm run start:landing --prefix middleware-platform

# Terminal 2 — landing UI at http://localhost:5180 (proxies /api → :4000)
npm run dev:landing:ui
```

### Full middleware (voice, RCM, workers)

```bash
cd unified-dashboard/somo-landing && npm install && npm run build
cd middleware-platform && npm start
```

### Optional: bloated local DB

If `:4000` is still slow with the light profile, `middleware-dev.db` may be very large. Back it up and start fresh, or run `VACUUM` after auditing growth.

## Env (middleware)

```bash
DODGECALL_DEMO_ENABLED=1
API_BASE_URL=http://localhost:4000
TWILIO_OUTBOUND_WEBHOOK_URL=https://YOUR-SUBDOMAIN.ngrok-free.app  # for real demo calls locally
```

| Variable | Notes |
|----------|-------|
| `DEV_LIGHT_START` | `1` skips post-listen background workers (local only) |
| `CATALOG_MASTER_SYNC_ENABLED` | `0` disables OBF catalog sync child in dev |
| `EHR_SYNC_ENABLED` | `0` disables EHR polling workers |

## Env (landing)

| Variable | Notes |
|----------|-------|
| `VITE_API_BASE` | Empty = same-origin API |
| `VITE_SIGNUP_URL` | Default `/signup?utm_source=somo` |

## Deploy (Firebase)

```bash
npm run deploy:landing-hosting
```

Builds `somo-landing` and deploys to Firebase Hosting (`callsomo.com`).

## Scripts

```bash
npm run build:somo-landing --prefix middleware-platform
npm run test:e2e-somo-landing --prefix middleware-platform
npm run smoke:somo-demo --prefix middleware-platform
npm run start:landing --prefix middleware-platform   # light middleware for landing dev
npm run dev:landing:ui                               # Vite on :5180
```

## Signup CTA

`/signup?utm_source=somo` on the same host as the landing.


---

<a id="somo-landing-hero"></a>

## SOMO LANDING HERO

*Merged from `docs/deployment/SOMO_LANDING_HERO.md` on 2026-06-02.*

# Somo landing — hero section

**Last Updated:** 2026-05-30

Marketing hero at `/` (`unified-dashboard/somo-landing/`). Styles: `src/styles/somo-hero.css` (imported via `somo.css`). Palette: [SOMO_MARKETING_COLORS.md](../design/SOMO_MARKETING_COLORS.md).

## Structure

| Piece | Component / class |
|-------|-------------------|
| Nav | `Hero.jsx` → `.somo-nav`, `.somo-nav-cta` |
| Copy | `.somo-hero-copy` (badge, h1, sub, CTAs, checks) |
| Phone | `.somo-hero-visual` → `hero-phone-v2.jpg` |
| Trust bar | `TrustBar.jsx` → `.somo-hero-trust` |

## Assets

| File | Use |
|------|-----|
| `public/assets/brand/somo-logo.png` | Nav lockup |
| `public/assets/brand/hero-phone-v2.jpg` | Hero phone + language orbit (1024×858) |
| `public/assets/brand/trusted/*.svg` | Trust bar logos |

Preloaded in `index.html`: logo + hero phone.

## Desktop (≥961px)

- Hero background: **white** (`#ffffff`). Page body matches.
- Hero fills **one viewport** (`min-height` / `max-height: 100dvh`); demo section is below the fold.
- Grid: ~`0.88fr` copy / `1.12fr` visual (`1.14fr` visual at ≥1280px).
- Phone scales to **100% height** of the grid row (`object-fit: contain`), clipped inside `.somo-hero-visual` so it does not overlap the trust bar.
- Nav: larger logo (68px) and “Try for $0” pill.

## Mobile (≤960px)

- Stacked grid; hero height is **auto** (scroll to demo + trust).
- Checks and trust logos: single centered rows.

## Copy (current)

- Headline: “Never answer business calls again.”
- Sub: “Somo is your smartest assistant. It answers calls, books appointments, and handles billing so you can focus on what matters.”
- Hero CTAs: “Try live demo” (scroll to `#demo`), “Sign Up” (`VITE_SIGNUP_URL`).
- Nav CTA: “Try for $0” (signup).

## Local preview

```bash
cd unified-dashboard/somo-landing && npm run build
cd middleware-platform && npm run start:landing
# http://localhost:4000/
```

Or `npm run dev:landing:ui` → http://localhost:5180 (rebuild or HMR for CSS).

## Related

- [SOMO_LANDING.md](./SOMO_LANDING.md) — dev, env, deploy
- [../Brand/SOMO_GUIDELINES.md](../Brand/SOMO_GUIDELINES.md) — tokens and palette


---

<a id="somo-demo-landing"></a>

## SOMO DEMO LANDING

*Merged from `docs/deployment/SOMO_DEMO_LANDING.md` on 2026-06-02.*

# Somo demo landing (superseded)

This doc moved to **[SOMO_LANDING.md](./SOMO_LANDING.md)**.

**Last Updated:** 2026-05-30

The unified Somo marketing landing lives at `unified-dashboard/somo-landing/`. Legacy `littlelab-landing` is archived under `unified-dashboard/_archive/littlelab-landing/`.


---

<a id="staging-cloudsql"></a>

## STAGING CLOUDSQL

*Merged from `docs/deployment/STAGING_CLOUDSQL.md` on 2026-06-02.*

# Staging Cloud SQL (Postgres mirror)

> **Project:** `somo-callsomo` · **Region:** `us-central1` · **Instance:** `somo-staging-pg`

SQLite remains **primary** for reads/writes in `middleware-platform/database.js`. Cloud SQL Postgres is provisioned for mirror/write-through, backups, and the future Postgres-primary flip.

## Provision (operator)

```bash
export GCP_PROJECT=somo-callsomo
export REGION=us-central1
export INSTANCE=somo-staging-pg
export CONNECTION_NAME="${GCP_PROJECT}:${REGION}:${INSTANCE}"

# Create instance (Postgres 15, smallest tier for staging)
gcloud sql instances create "$INSTANCE" \
  --project="$GCP_PROJECT" \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-auto-increase \
  --backup

gcloud sql databases create somo_staging --instance="$INSTANCE" --project="$GCP_PROJECT"

# App user (replace PASSWORD before running)
gcloud sql users create somo_app \
  --instance="$INSTANCE" \
  --project="$GCP_PROJECT" \
  --password='CHANGE_ME'

# Store connection string in Secret Manager
echo -n "postgresql://somo_app:CHANGE_ME@/somo_staging?host=/cloudsql/${CONNECTION_NAME}" | \
  gcloud secrets create somo-staging-postgres-url --data-file=- --project="$GCP_PROJECT" \
  || gcloud secrets versions add somo-staging-postgres-url --data-file=- --project="$GCP_PROJECT"
```

## Cloud Run connector

Deploy with:

```bash
export CLOUDSQL_CONNECTION_NAME="${GCP_PROJECT}:${REGION}:${INSTANCE}"
./scripts/deploy-to-gcp.sh
```

`generate-cloudrun-env-yaml.cjs` reads `POSTGRES_URL` from Secret Manager when `USE_GCP_SECRETS=1`.

## Verify

```bash
# From a Cloud Run Job with the same connector:
psql "$POSTGRES_URL" -c 'SELECT 1'
```

## Related

- Durable SQLite: `middleware-platform/scripts/cloudrun-db-sync.cjs` + `GCS_DB_BUCKET=somo-staging-db`
- Env SSOT: `middleware-platform/.env.staging.example`
- Deploy: `scripts/deploy-to-gcp.sh`


---

<a id="staging-cron"></a>

## STAGING CRON

*Merged from `docs/deployment/STAGING_CRON.md` on 2026-06-02.*

# Staging scheduled jobs (Cloud Scheduler)

Trial maintenance and optional DLQ workers on **staging** (`api.callsomo.com`).

## Jobs

| Job | Schedule (UTC) | Command |
|-----|----------------|---------|
| Trial expiry sweep | `0 6 * * *` (daily 06:00) | `npm run trial:expiry-sweep:apply` |
| Trial nudge emails | `0 14 * * *` (daily 14:00) | `npm run trial:nudge-sweep` |

## Cloud Run Job pattern

Create one job image (same as `somo-middleware`) with overridden command:

```bash
export PROJECT=somo-callsomo
export REGION=us-central1
export JOB=somo-staging-cron-trial-expiry

gcloud run jobs create "$JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="gcr.io/${PROJECT}/somo-middleware:latest" \
  --set-cloudsql-instances="${PROJECT}:${REGION}:somo-staging-pg" \
  --set-env-vars="CLOUDRUN_PROFILE=staging" \
  --command="npm" \
  --args="run,trial:expiry-sweep:apply" \
  --tasks=1 \
  --max-retries=1
```

Repeat for `somo-staging-cron-trial-nudge` with args `run,trial:nudge-sweep`.

## Cloud Scheduler

```bash
gcloud scheduler jobs create http somo-staging-trial-expiry \
  --project="$PROJECT" \
  --location="$REGION" \
  --schedule="0 6 * * *" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="somo-staging-scheduler@${PROJECT}.iam.gserviceaccount.com"
```

Grant the scheduler SA `roles/run.invoker` on the job.

## Local dry-run

```bash
cd middleware-platform
npm run trial:expiry-sweep          # dry-run
npm run trial:nudge-sweep
```

## Related

- Trial rollout: [STAGING_TRIAL_ROLLOUT.md](./STAGING_TRIAL_ROLLOUT.md)
- Bootstrap: `npm run bootstrap:staging --prefix middleware-platform`


---

<a id="staging-observability"></a>

## STAGING OBSERVABILITY

*Merged from `docs/deployment/STAGING_OBSERVABILITY.md` on 2026-06-02.*

# Staging observability and ops

## Logging alerts (GCP)

Configure in Cloud Monitoring for service `somo-middleware` (`us-central1`):

| Alert | Condition |
|-------|-----------|
| Error rate | 5xx > 5% over 5 min |
| Startup failures | Cloud Run revision failed / probe failures |
| Latency | p95 > 10s on `/voice/*` |

## Uptime checks

| URL | Expected |
|-----|----------|
| `https://api.callsomo.com/health/live` | 200 |
| `https://callsomo.com/` | 200 |
| `https://callsomo.com/signup` | 200 HTML |

Use `npm run gcp:bootstrap:check` for quick HTTP verification.

## Secret rotation

Rotate in **GCP Secret Manager** (`somo-staging-*` prefix), then redeploy:

- `JWT_SECRET` — invalidates existing sessions
- `TWILIO_AUTH_TOKEN`, `RETELL_API_KEY`, `STRIPE_*`
- `SOMO_OWNER_PASSWORD` — run `npm run ensure:somo-owner` after change

Document rotation date in team runbook.

## Rollback

```bash
./scripts/rollback-gcp-release.sh
```

Firebase Hosting: redeploy prior `hosting-dist` or use Firebase release history.

## Railway

**Deprecated for staging/production.** CI no longer deploys to Railway. API SSOT: Cloud Run `somo-middleware`. See [`SOMO_CLOUD_RUN_DEPLOY.md`](./SOMO_CLOUD_RUN_DEPLOY.md).

## Related

- [GCP_DEPLOY_ROLLBACK_RUNBOOK.md](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)
- [STAGING_SIGNOFF.md](./STAGING_SIGNOFF.md)


---

<a id="staging-signoff"></a>

## STAGING SIGNOFF

*Merged from `docs/deployment/STAGING_SIGNOFF.md` on 2026-06-02.*

# Staging sign-off checklist (callsomo.com)

Complete after `./scripts/deploy-staging-all.sh` or `.github/workflows/deploy-staging.yml`.

## Automated gates

```bash
npm run gcp:bootstrap:check
npm run smoke:staging
STAGING=1 npm run gate:week1 --prefix middleware-platform
npm run test:e2e:staging --prefix middleware-platform
```

### Somo SaaS diagnostic (signup · Twilio · agent · calls)

Full step IDs, env vars, and failure matrix: **[STAGING_DIAGNOSTIC_RUNBOOK.md](../testing/STAGING_DIAGNOSTIC_RUNBOOK.md)**.

```bash
cd middleware-platform
export STAGING_DB_PATH=...          # GCS download of middleware-staging.db (optional for A5 asserts)
export STAGING_EMAIL_CODE=...       # inbox OTP for signup S2–S7 (or POSTGRES_URL for live SQL)
export TRIAL_E2E_PHONE=+1...        # receives Twilio Verify SMS
export STAGING_SMS_CODE=...         # after SMS (phone step)
export SOMO_OWNER_EMAIL=...
export SOMO_OWNER_PASSWORD=...

npm run staging:preflight
API_BASE_URL=https://api.callsomo.com STAGING_SMS_CODE=... npm run staging:trial-provision
npm run test:e2e:staging-signup
npm run test:e2e:staging-voice

# After manual inbound call to tenant DID:
npm run staging:call-verify -- --customer-id=<trial-customer-id>
```

## Manual checklist

- [ ] https://callsomo.com/ — landing loads, demo CTA visible
- [ ] https://callsomo.com/signup?fresh=1 — SIM trial signup completes
- [ ] https://callsomo.com/login — owner login (`SOMO_OWNER_EMAIL`)
- [ ] https://callsomo.com/business/agent.html — greeting save + Retell sync
- [ ] Inbound call to staging Twilio line → agent answers; `voice_call_log.customer_id` = owner
- [ ] Redeploy API (`./scripts/deploy-to-gcp.sh`) → owner + trial data **still present** (GCS SQLite + Cloud SQL mirror)

## Bootstrap (first time on staging DB)

```bash
# Cloud Run Job (recommended)
./scripts/deploy-staging-bootstrap-job.sh

# Or local against staging env snapshot
cd middleware-platform && npm run bootstrap:staging
```

Twilio voice URL must be:

`https://api.callsomo.com/voice/incoming?customer_id=<OWNER_CUSTOMER_ID>`

## Rollback drill

```bash
./scripts/rollback-gcp-release.sh
# Firebase: redeploy previous hosting-dist from git tag or local backup
```

## Related

- [STAGING_DIAGNOSTIC_RUNBOOK.md](../testing/STAGING_DIAGNOSTIC_RUNBOOK.md)
- [CALLSOMO_GCP_CUTOVER.md](../runbooks/CALLSOMO_GCP_CUTOVER.md)
- [STAGING_TRIAL_ROLLOUT.md](./STAGING_TRIAL_ROLLOUT.md)
- [STAGING_CLOUDSQL.md](./STAGING_CLOUDSQL.md)
- [GCP_DEPLOY_ROLLBACK_RUNBOOK.md](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)


---

<a id="staging-trial-rollout"></a>

## STAGING TRIAL ROLLOUT

*Merged from `docs/deployment/STAGING_TRIAL_ROLLOUT.md` on 2026-06-02.*

# Staging rollout — provider SIM trial

**Last updated:** 2026-05-29  
**Staging host:** [`CALLSOMO_GCP_CUTOVER.md`](../runbooks/CALLSOMO_GCP_CUTOVER.md) — UI on `callsomo.com`, API on `api.callsomo.com`  
**Flow:** [PROVIDER_SIGNUP_FLOW.md](./PROVIDER_SIGNUP_FLOW.md)  
**Architecture:** [PROVIDER_TRIAL_SIM_ARCHITECTURE.md](./PROVIDER_TRIAL_SIM_ARCHITECTURE.md)

## Required environment (staging API host)

Set on the Cloud Run / staging middleware service (not committed to git):

```bash
TRIAL_SIM_FLOW_ENABLED=1
TRIAL_SIM_LAUNCH_AT=2026-05-28T00:00:00Z
TRIAL_DEFAULT_AREA_CODE=202
TWILIO_VERIFY_SERVICE_SID=VA...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
RETELL_API_KEY=...
RETELL_AGENT_ID=...
API_BASE_URL=https://api.callsomo.com
BASE_URL=https://api.callsomo.com
```

`API_BASE_URL` must be the **public HTTPS** URL Twilio uses for voice webhooks (`/voice/incoming?customer_id=`).

## Deploy

1. Deploy branch `docs-cleanup-and-coding-2026-05-25` (includes SIM trial merge) to staging.
2. Confirm migrations run on startup (`trial_status`, `phone_verified` columns).
3. Restart / roll out revision after env change.

## Smoke checklist

- [ ] `GET /health` returns 200
- [ ] `node scripts/sandbox-trial-signup-report.cjs` — verify-phone not 404, `TRIAL_SIM_FLOW_ENABLED` true
- [ ] `node scripts/trial-provision-smoke.cjs` — creates customer with `twilio_phone_number` (costs one Twilio number). If Verify SMS 404s locally, set `TWILIO_VERIFY_DEV_MOCK=1` in `.env`, **restart the server**, then re-run smoke (OTP `000000`).
- [ ] Full signup: `https://callsomo.com/signup?fresh=1` (after `npm run deploy:staging-hosting`) → email → phone OTP → terms → trial activation
- [ ] DB: `trial_status=active`, `twilio_phone_number` set, `phone_verified=1`
- [ ] Inbound call to provisioned number reaches Kelly (not trial-paused TwiML)
- [ ] Second signup with same phone → `phone_trial_in_use`

## Trial expiry cron

Dry-run first:

```bash
cd middleware-platform
npm run trial:expiry-sweep
npm run trial:expiry-sweep:apply
```

Schedule daily (UTC example in [PROVIDER_SIGNUP_FLOW.md](./PROVIDER_SIGNUP_FLOW.md)).

## E2E

**Staging (live hosts):** [STAGING_DIAGNOSTIC_RUNBOOK.md](../testing/STAGING_DIAGNOSTIC_RUNBOOK.md) — `npm run test:e2e:staging-signup`, `staging:trial-provision`, `staging:call-verify`.

**Local API:**

```bash
cd middleware-platform
TRIAL_SIM_FLOW_ENABLED=1 npm start
# separate terminal:
npx playwright test e2e/provider-trial-signup.spec.cjs
```

## Rollback

Set `TRIAL_SIM_FLOW_ENABLED=0` — signup skips phone step; existing trials still expire via cron.


---

<a id="staging-myskinandcare"></a>

## STAGING MYSKINANDCARE

*Merged from `docs/deployment/STAGING_MYSKINANDCARE.md` on 2026-06-02.*

# Staging hosts (redirect)

**Retired filename.** Staging and production use **callsomo.com**.

→ **[`docs/runbooks/CALLSOMO_GCP_CUTOVER.md`](../runbooks/CALLSOMO_GCP_CUTOVER.md)**

Legacy DNS: **[`docs/runbooks/LEGACY_DOMAIN_RETIREMENT.md`](../runbooks/LEGACY_DOMAIN_RETIREMENT.md)**


---

<a id="voice-current-architecture"></a>

## VOICE CURRENT ARCHITECTURE

*Merged from `docs/deployment/VOICE_CURRENT_ARCHITECTURE.md` on 2026-06-02.*

# Voice architecture (current production)

> **Last reviewed:** 2026-05-27  
> **API host:** `https://api.callsomo.com` (Cloud Run `somo-middleware`, `us-central1`)

This document is the operational source of truth for **how voice calls work today** on callsomo.com production. RCM product context: [`docs/RCM/KELLY_RCM_ARCHITECTURE.md`](../RCM/KELLY_RCM_ARCHITECTURE.md).

## Split-domain layout

| Role | Host |
|------|------|
| Marketing / provider SPA | `https://callsomo.com` |
| Middleware API | `https://api.callsomo.com` |

Client apps must use `REACT_APP_API_BASE=https://api.callsomo.com` (not the marketing host for `/api/*`).

## Inbound calls (operational)

```text
PSTN caller → Twilio number → POST /voice/incoming
  → middleware registers call (Retell v2/register-phone-call)
  → TwiML <Dial><Sip>…</Dial>
  → Retell bridges audio and opens WSS to /webhook/retell/llm
```

**Status:** Operational (verified via signed webhook test and Cloud Run `200` on `/voice/incoming`).

**Implementation:** [`middleware-platform/server.js`](../../middleware-platform/server.js) — Twilio signature required in production.

## Outbound calls (two supported paths)

### Path A — Twilio-direct (operational default in code)

```text
App or script → Twilio REST calls.create
  → webhook URL = https://api.callsomo.com/voice/incoming?…
  → same register + SIP + WSS flow as inbound
```

**Status:** Operational.

**Used by:**

- [`middleware-platform/scripts/make-outbound-call.js`](../../middleware-platform/scripts/make-outbound-call.js)
- [`middleware-platform/routes/outbound-call.js`](../../middleware-platform/routes/outbound-call.js) (`POST /api/voice/outbound/call`)

### Path B — Retell `create-phone-call` (custom telephony)

```text
App → Retell POST /v2/create-phone-call
  → Retell places PSTN leg via imported Twilio number + SIP trunk
  → on success, same Retell session + WSS
```

**Status:** Supported with external dependency.  
**Failure mode:** `not_connected` + `disconnection_reason=telephony_provider_permission_denied` when Retell cannot authenticate to the configured Twilio SIP termination (wrong URI, username/password, or trunk mismatch).

**Retell docs:** [Debug outbound connection issues](https://docs.retellai.com/reliability/debug-outbound-call)

## Retell agent configuration

| Setting | Production value |
|---------|------------------|
| Agent ID (production) | `agent_85c66c32dec5575db0ed066130` |
| Custom LLM WebSocket | `wss://api.callsomo.com/webhook/retell/llm` |
| Push config from repo | `node configure-retell.js` (with `API_BASE_URL=https://api.callsomo.com`) |

Machine-readable inventory for `npm run verify:agent-config`: [`retell-agent-inventory.json`](./retell-agent-inventory.json) — see [`retell-agent-inventory.md`](./retell-agent-inventory.md).

## Twilio SIP (custom telephony for Path B)

When configuring Retell imported number telephony against Twilio:

| Field | Guidance |
|-------|----------|
| Origination SIP URI (Twilio trunk → Retell) | `sip:sip.retellai.com` (repo scripts expect this; confirm in Retell dashboard if region-specific) |
| Termination SIP URI (Retell → Twilio) | Must match **current** Twilio SIP domain/trunk in the **same** Twilio account as `TWILIO_ACCOUNT_SID` |
| Outbound transport | **TCP** (default in docs; do not switch to UDP without testing) |
| Auth username | Twilio credential **username** (not credential list friendly name) |

**Legacy example only (may not exist in current account):** trunk SID `TKef81908…`, domain `aimedicalvoiceagent.pstn.twilio.com`, credential list `retell-outbound`. Always verify live objects in Twilio Console before pasting into Retell.

## Smoke tests

```bash
# Liveness (Cloud Run startup probe path)
curl -sS -o /dev/null -w '%{http_code}\n' https://api.callsomo.com/health/live

# Retell LLM HTTP probe
curl -sS https://api.callsomo.com/webhook/retell/llm

# Outbound (Twilio-direct path)
cd middleware-platform && node scripts/make-outbound-call.js 8622307479

# Retell agent config vs inventory
cd middleware-platform && npm run verify:agent-config
```

## Per-provider settings (portal → live calls)

Tenant resolution on inbound: `To` (Twilio) → `customers.twilio_phone_number` → `customer_id` / `merchant_id`.

| Setting | Storage | Applied at call time |
|---------|---------|---------------------|
| On/off | `customers.kelly_status` + `voice_agent_settings.enabled` | `/voice/incoming` TwiML gate + WebSocket `applyProviderRuntime` |
| Greeting | `voice_agent_settings.greeting` | First spoken response after `call_details` |
| Business hours | `voice_agent_settings.business_hours` | After-hours message, then `end_call` (no Kelly) |
| Custom behavior | `customers.custom_prompt` | Prepended to Kelly system prompt (voice channel) |

**Trial without `merchant_id`:** settings are stored on `voice_agent_settings` with synthetic `merchant_id = cust:{customer_id}` and `customer_id` set. Authenticated `/api/voice-agent/settings` does **not** fall back to the default subdomain merchant.

**Persona defaults:** `voice-prompt-templates.js` maps `customers.use_case` to a default `custom_prompt` on trial provision and `POST /api/voice-agent/setup-complete` when empty.

Implementation: [`voice-agent-runtime.js`](../../middleware-platform/services/voice-agent-runtime.js), [`retell-websocket.js`](../../middleware-platform/webhooks/retell-websocket.js).

Provider UI: [`agent.html`](../../unified-dashboard/business/agent.html); first-run [`voice-setup.html`](../../unified-dashboard/business/voice-setup.html).

### Call outcomes and recent-call labels

| `voice_call_log.outcome` | When set |
|--------------------------|----------|
| `booked` | Successful `schedule_appointment` without PA flag |
| `pa_flagged` | Booking with `requires_prior_auth` or pending PA status |
| `transferred` | Caller or Kelly phrasing indicates handoff to staff |
| `voicemail` | Call under ~45s with no prior outcome |
| `info` | Default completed call |

`caller_label` and `caller_phone` are persisted at call end from the WebSocket session (name capture or formatted PSTN). Stats API returns labels via `GET /api/customer/dashboard/agent/stats`.

**Postgres:** `_syncVoiceCallToPostgres` includes `outcome`, `caller_label`, and `caller_phone`. Run:

```bash
cd middleware-platform
DATABASE_URL=postgres://... node scripts/migrate-voice-call-log-postgres.cjs
```

New exports also get columns via [`export-sqlite-to-postgres.js`](../../middleware-platform/scripts/export-sqlite-to-postgres.js).

## Related runbooks

- Deploy / rollback: [`docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)
- Edge routing: [`EDGE_ROUTING_CONFIGS.md`](./EDGE_ROUTING_CONFIGS.md)


---

<a id="voice-subscription-billing-architecture"></a>

## VOICE SUBSCRIPTION BILLING ARCHITECTURE

*Merged from `docs/deployment/VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md` on 2026-06-02.*

# Voice subscription billing architecture

> **Last reviewed:** 2026-05-28  
> **Status:** Target architecture (implementation in progress)  
> **Voice telephony:** [VOICE_CURRENT_ARCHITECTURE.md](./VOICE_CURRENT_ARCHITECTURE.md)  
> **Task tracker (archived v1):** [todos/archive/VOICE_BILLING_SUBSCRIPTION_TODOS_COMPLETED_2026-05-31.md](../../todos/archive/VOICE_BILLING_SUBSCRIPTION_TODOS_COMPLETED_2026-05-31.md)

![Voice subscription billing architecture](./assets/voice-subscription-architecture.svg)

## Scope

This document covers **platform billing** for the AI receptionist (SaaS customer): subscriptions, minute buckets, top-ups, ingress gating, and Twilio provisioning.

It does **not** cover **RCM practice revenue** (patient claims, invoices, patient payments) in [`unified-dashboard/business/billing.html`](../../unified-dashboard/business/billing.html).

## Locked product decisions

| ID | Decision |
|----|----------|
| D1 | Pack-only at zero — hard block inbound; no metered $0.05 overage |
| D2 | Top-ups: $20/100, $30/180, $50/330 min |
| D3 | Starter $79/300, Practice $199/900, Clinic Pro $399/2000 |
| D4 | **60** free SIM trial minutes (7-day cap) until first paid subscription; see [PROVIDER_TRIAL_SIM_ARCHITECTURE.md](./PROVIDER_TRIAL_SIM_ARCHITECTURE.md) |
| D6 | `past_due` grace: 3 days, then suspend |
| D7 | Retell agent paused on suspend; not auto-deleted |
| D9 | Twilio number held 30 days after cancel, then released |

## Plan catalog

Source: [`middleware-platform/config/plan-catalog.json`](../../middleware-platform/config/plan-catalog.json)

| Tier | Price/mo | Included min | Numbers | Rate limit (/min) |
|------|----------|--------------|---------|-------------------|
| starter | $79 | 300 | 1 | 30 |
| practice | $199 | 900 | 1 | 75 |
| clinic_pro | $399 | 2000 | 2 | 150 |

`vertical` (`general` | `healthcare`) changes display labels and HIPAA flags only — not a second price ladder.

## Target vs current (delta)

| Area | Current (pre-migration) | Target |
|------|-------------------------|--------|
| Usage deduction | Split: Twilio `deductCredits` vs Retell pre-check | Single `applyUsage()` |
| Inbound at 0 min | Warn only; call connects | TwiML reject |
| Number provision | SIM trial: on phone verify; legacy: after `invoice.paid` | Trial + paid paths in `trial-lifecycle.js` |
| Subscriptions | Card verify + pay-as-you-go | Stripe Subscription + catalog |
| Overage | $0.05/min tracked, not auto-charged | None (pack-only) |
| Tier limits | Global 150 req/min | Per-tier from catalog |

## Subscription state machine

```text
                    ┌─────────────┐
     signup/trial   │   trialing   │ (free minutes, no sub)
                    └──────┬──────┘
                           │ invoice.paid
                           ▼
                    ┌─────────────┐
              ┌────│   active    │────┐
              │    └─────────────┘    │
   payment    │                       │ cancel / unpaid end
   failed     ▼                       ▼
        ┌─────────────┐        ┌─────────────┐
        │  past_due   │        │  canceled   │
        │  (3d grace) │        │  (30d # hold)│
        └──────┬──────┘        └─────────────┘
               │ grace expired
               ▼
        ┌─────────────┐
        │  suspended  │  Retell enabled=false, inbound blocked
        └─────────────┘
```

## Stripe webhook matrix

| Event | Action |
|-------|--------|
| `invoice.paid` | Set `subscription_status=active`, grant `included_minutes_per_cycle`, `cycle_reset_at`, sync `plan_tier`; provision Twilio if missing |
| `customer.subscription.updated` | Map Stripe status → `active` / `past_due` / `canceled`; set `past_due_since` |
| `customer.subscription.deleted` | `canceled`, `canceled_at`, `number_retention_until` |
| `checkout.session.completed` (payment) | Add `topup_balance_minutes`; record purchase |

Handler: [`middleware-platform/services/voice-billing-stripe.js`](../../middleware-platform/services/voice-billing-stripe.js) via [`routes/stripe-webhook-handler.js`](../../middleware-platform/routes/stripe-webhook-handler.js).

## Ingress gate

Evaluated on `POST /voice/incoming` via [`billing-access.js`](../../middleware-platform/services/billing-access.js):

1. `billing_enforcement_paused` → allow (support override)
2. `subscription_status` in `suspended` / `canceled` (and past_due past grace) → reject
3. `total_minutes` (plan + top-up + balance) ≤ 0 → reject
4. Else → allow (subject to tier rate limit)

Reject response: TwiML `<Say>` + `<Hangup>`.

## Usage application

On call end (Twilio status **or** Retell WS — same code path):

1. Idempotency: `usage_events.call_id` UNIQUE
2. Deduct up to requested minutes: **plan pool first**, then **top-up** (pack-only — never negative)
3. Track `monthly_usage.voice_minutes_used` for reporting

## Environment variables

See [`middleware-platform/.env.example`](../../middleware-platform/.env.example) — `STRIPE_PRICE_*` for subscription and top-up price IDs.

## Related files

| File | Role |
|------|------|
| `services/apply-usage.js` | Unified deduction |
| `services/billing-access.js` | Gate + provision rules |
| `services/plan-catalog.js` | Catalog loader |
| `services/voice-billing-stripe.js` | Stripe webhook + checkout helpers |
| `routes/voice-billing.js` | Checkout API |
| `scripts/billing-lifecycle-sweep.cjs` | Grace expiry, number release |


---

<a id="voice-billing-test-results"></a>

## VOICE BILLING TEST RESULTS

*Merged from `docs/deployment/VOICE_BILLING_TEST_RESULTS.md` on 2026-06-02.*

# Voice billing test results

**Generated:** 2026-05-28  
**Runner:** `npm run billing:test-scenarios` (plus individual scripts)

## Summary

| Status | Count | Notes |
|--------|-------|-------|
| Pass (automated) | 17 | Jest + in-process scripts |
| Manual / skip | 4 | T1.4 Retell call, T4.1 signup UI, T4.2/T4.3 full E2E, T2.2 HTTP until server restart |
| Pass after server restart | T2.1, T2.2 HTTP, T2.5 HTTP | Restart `npm start` after pulling billing gate |

## Per-scenario

| ID | Status | How verified |
|----|--------|----------------|
| T1.1 | **pass** | `__tests__/apply-usage.test.js` idempotency |
| T1.2 | **pass** | jest plan-before-topup |
| T1.3 | **pass** | jest zero balance + `usage_events` |
| T1.4 | **skip** | Manual Retell; `completed_no_credits` absent in repo |
| T2.1 | **pass** | HTTP `billing:test-gate` (needs live server) |
| T2.2 | **pass** | `__tests__/billing-access-gate.test.js`; HTTP pass after server restart |
| T2.3 | **pass** | jest grace + expired grace |
| T2.4 | **pass** | jest canceled |
| T2.5 | **pass** | `__tests__/clinic-rate-limiter-tier.test.js` |
| T3.1 | **pass** | `billing:test-webhooks` + `STRIPE_PRICE_*` in `.env` |
| T3.2 | **pass** | Same script (invoice.paid grant) |
| T3.3 | **pass** | `billing:test-webhooks` top-up |
| T3.4 | **pass** | `stripe-webhook-handler.js` event id table (manual replay via Stripe CLI) |
| T3.5 | **pass** | `billing:test-webhooks` |
| T3.6 | **pass** | `billing:test-webhooks` |
| T4.1 | **manual** | Signup flow → settings `?billing=subscribe` |
| T4.2 | **manual** | Stripe Checkout after `billing:setup-stripe-prices` |
| T4.3 | **manual** | Trial minutes + calls |
| T5.1 | **pass** | `billing:test-alerts` |
| T5.2 | **pass** | `billing:test-alerts` debounce |
| T5.3 | **pass** | Settings UI shows `X of Y min remaining` + top-up note |
| T6.1 | **pass** | `billing:test-admin` |
| T6.2 | **pass** | `billing:test-admin` |
| T6.3 | **pass** | `billing:audit-numbers` with seeded orphan |
| T6.4 | **pass** | `billing:voice-smoke` |

## Commands

```bash
cd middleware-platform
export DB_PATH=./middleware-dev.db
export TWILIO_WEBHOOK_SIGNATURE_REQUIRED=0

npm run billing:test-scenarios    # full automated suite
npm run billing:setup-stripe-prices -- --write-env   # once per Stripe test account
stripe listen --forward-to localhost:4000/webhooks/stripe
```

**Important:** Restart the API after code changes so `/voice/incoming` loads the billing gate.

## Stripe test prices

Created via `billing:setup-stripe-prices` and written to `middleware-platform/.env`.


---

<a id="provider-signup-flow"></a>

## PROVIDER SIGNUP FLOW

*Merged from `docs/deployment/PROVIDER_SIGNUP_FLOW.md` on 2026-06-02.*

# Provider signup flow (SIM trial)

**Last updated:** 2026-05-29  
**Architecture:** [PROVIDER_TRIAL_SIM_ARCHITECTURE.md](./PROVIDER_TRIAL_SIM_ARCHITECTURE.md)

## Primary UI

| Host | Signup page |
|------|-------------|
| Root / marketing (`GET /signup`) | [unified-dashboard/signup.html](../../unified-dashboard/signup.html) — Somo wizard (`signup-wizard.js`, `signup-somo.css`) |
| API subdomain (`GET /` on api.*) | [middleware-platform/public/signup/index.html](../../middleware-platform/public/signup/index.html) |

Marketing signup calls the same `/api/signup/*` endpoints. Terms: [middleware-platform/public/signup/terms.html](../../middleware-platform/public/signup/terms.html) (also inline accept on wizard step 6).

## Somo wizard steps (marketing / `utm_source=somo`)

```text
Landing demo (optional, prefill via sessionStorage somo_signup_prefill)
  → Step 1: Persona cards (use_case)
  → Step 2: Name, business, email, mobile
  → Step 3: Country, city, postal (local number)
  → Step 3b (optional): License / specialty — skippable for healthcare persona
  → POST /api/signup (light SaaS; license only if specialty + license fields sent)
  → Step 4: Email OTP
  → Step 5: Phone SMS (auto-send) → number reveal hero
  → Step 6: Accept terms (wizard) OR /terms
  → POST /api/signup/accept-terms
  → /business/trial-activation.html?welcome=1
  → /business/voice-setup.html (3-step greeting, hours, call your line)
  → /business/agent.html (control center; 60 min / 7 days trial)
  → Subscribe later via Stripe
```

Progress bar shows **Step N of M** (M excludes phone step when `TRIAL_SIM_FLOW_ENABLED` is off).

## SaaS happy path (SIM enabled)

```text
/signup?utm_source=somo|dodgecall
  → POST /api/signup
  → POST /api/signup/verify-email
  → POST /api/signup/verify-phone/send + check → startTrialTenant()
  → POST /api/signup/accept-terms
  → /business/trial-activation.html
```

When `TRIAL_SIM_FLOW_ENABLED` is off, after email verify the wizard skips phone and goes to terms (legacy paywall / subscribe paths).

## Redirect contract

| Step | Condition | Redirect |
|------|-----------|----------|
| After email verify | SIM on (`trial_sim_flow: true`) | `/signup?step=phone` |
| After email verify | SIM off | `/signup?step=terms` or `/terms` |
| After phone verify + trial | Trial started | `/signup?step=terms` (inline) |
| After accept-terms | SIM on, phone not verified | `/signup?step=phone` |
| After accept-terms | SIM on, trial active | `/business/trial-activation.html?welcome=1` → `/business/voice-setup.html` |
| After accept-terms | SIM off, needs subscription | `/business/settings.html?billing=subscribe` |
| After accept-terms | Card verified (legacy) | `/signup-complete` |
| After Stripe success | Paid | `/business/settings.html?billing=success` |

## Signup API — optional license

`POST /api/signup` requires license + specialty only when `medical_specialty` or `require_provider_profile: true` is sent. Light SaaS signups use single `name` plus `phone_number` without provider credential fields.

## API endpoints

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/signup` | Public |
| POST | `/api/signup/verify-email` | Public (sets `customer_session`) |
| GET | `/api/signup/session` | `customer_session` |
| POST | `/api/signup/verify-phone/send` | Session + email verified |
| POST | `/api/signup/verify-phone/check` | Same |
| POST | `/api/signup/accept-terms` | Session |
| POST | `/api/voice-billing/trial-welcome-dismiss` | Session |
| GET | `/api/voice-billing/status` | Session |
| POST | `/api/voice-billing/checkout/subscription` | Session |

## Portal session (browser)

After verify-email, verify-phone, or accept-terms, the UI hydrates `sessionStorage.customer` via [provider-session.js](../../unified-dashboard/assets/js/provider-session.js).

## Trial activation page

[unified-dashboard/business/trial-activation.html](../../unified-dashboard/business/trial-activation.html) — first run after terms:

- Shows dedicated `twilio_phone_number`, trial minutes/days from `GET /api/voice-billing/status`
- Demo-aware copy when `utm_source` is `somo` or `dodgecall` and `somo_signup_prefill` exists
- Primary CTA → `/business/voice-setup.html`
- Dismiss → `POST /api/voice-billing/trial-welcome-dismiss` → voice setup

## Voice agent control center

- [unified-dashboard/business/agent.html](../../unified-dashboard/business/agent.html) — line status, toggle (`PATCH /api/kelly/toggle`), greeting/hours, call KPIs
- Settings → Voice tab is read-only summary with links to `agent.html`
- Live calls read `voice_agent_settings` + `customers.custom_prompt` in [retell-websocket.js](../../middleware-platform/webhooks/retell-websocket.js) via [voice-agent-runtime.js](../../middleware-platform/services/voice-agent-runtime.js)

## Landing → signup prefill

After a successful demo call, [somo-landing](../../unified-dashboard/somo-landing/) stores `somo_signup_prefill` (`name`, `phone`, `use_case`) for the wizard.

## Staging / cron

```bash
TRIAL_SIM_FLOW_ENABLED=1
TRIAL_SIM_LAUNCH_AT=2026-05-28T00:00:00Z
TWILIO_VERIFY_SERVICE_SID=...
```

E2E:

- `npx playwright test middleware-platform/e2e/somo-signup-wizard.spec.cjs`
- `npx playwright test --project provider-trial` (API trial path)


---

<a id="provider-trial-sim-architecture"></a>

## PROVIDER TRIAL SIM ARCHITECTURE

*Merged from `docs/deployment/PROVIDER_TRIAL_SIM_ARCHITECTURE.md` on 2026-06-02.*

# Provider SIM trial architecture

**Last updated:** 2026-05-28  
**Status:** Implemented (feature-flagged)  
**Signup flow:** [PROVIDER_SIGNUP_FLOW.md](./PROVIDER_SIGNUP_FLOW.md)  
**Voice billing:** [VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md](./VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md)  
**Task tracker (archived v1):** [todos/archive/PROVIDER_TRIAL_SIM_TODOS_COMPLETED_2026-05-31.md](../../todos/archive/PROVIDER_TRIAL_SIM_TODOS_COMPLETED_2026-05-31.md)

## Product contract

| Rule | Value |
|------|--------|
| Trial gate | Phone verified via **Twilio Verify** (not email alone) |
| Trial minutes | **60** (from `plan-catalog.json` `signup_trial_minutes`) |
| Time cap | **7 days** from phone verify (`trial_expires_at`) |
| Access ends when | Minutes exhausted **or** day 7, whichever first |
| Number release | Trial expired without active subscription; or **21 days** no call activity |
| Conversion | Stripe subscription checkout; `trial_status=converted` on `invoice.paid` |
| Minutes accounting | Single path: `applyUsage()` + `usage_events` (no duplicate trial counter column) |

## Demo vs provider (isolation)

| World | Who | Number / agent | Data |
|-------|-----|----------------|------|
| **Demo** | Landing visitors | Shared Somo Twilio + Retell | `dodgecall_demo_requests` |
| **Provider** | Paying / trial customers | Dedicated per `customers` row | `customers`, portal call logs |

Nothing from demo carries over automatically. Signup bridge tracks `utm_source=dodgecall` for onboarding copy only.

## Feature flags

| Env | Purpose |
|-----|---------|
| `TRIAL_SIM_FLOW_ENABLED=1` | Enable SIM trial path |
| `TRIAL_SIM_LAUNCH_AT` | ISO timestamp; only customers `created_at >=` this date get SIM flow (unless internal override) |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify v2 service |

Rollback: set `TRIAL_SIM_FLOW_ENABLED=0` — signup reverts to plan-first redirect; expiry cron still releases expired trials.

## Data model (`customers`)

- `trial_status`: `none` \| `active` \| `exhausted` \| `expired` \| `converted`
- `trial_started_at`, `trial_expires_at`, `trial_phone_verified_at`
- `trial_last_activity_at`, `trial_release_reason`
- `phone_verified`, `phone_verified_at`
- `signup_attribution_json` (utm_source, etc.)
- `trial_welcome_dismissed_at`

Trial minutes consumed = sum `usage_events.minutes_applied` where `created_at >= trial_started_at`.

## Gating matrix (`billing-access.js`)

| Condition | Inbound |
|-----------|---------|
| `subscription_status=active` | Allow |
| `billing_enforcement_paused=1` | Allow |
| SIM trial active + minutes > 0 + not past `trial_expires_at` | Allow |
| Trial exhausted or expired | Block — trial paused TwiML |
| Subscription suspended / canceled (past grace) | Block — subscription TwiML |
| No minutes (pack-only) | Block |

## Provisioning

`startTrialTenant()` (idempotent):

1. Set trial timestamps and `trial_status=active`
2. `allocateFreeCredits(60)`
3. Create Retell agent if missing
4. Provision Twilio number if missing (`/voice/incoming?customer_id=`)

Paid conversion: `convertTrialToPaid()` on subscription — number retained.

## Cron

`npm run trial:expiry-sweep` — `scripts/trial-expiry-sweep.cjs`

- Job A: `trial_expires_at < now` and not subscribed → release number
- Job B: `trial_last_activity_at` older than 21 days and not subscribed → release

Use `--dry-run` before production provisioning.

## Code map

| File | Role |
|------|------|
| `services/trial-lifecycle.js` | Trial orchestration |
| `services/trial-alerts.js` | SMS + email nudges |
| `services/twilio-verify-service.js` | Phone OTP |
| `services/billing-access.js` | Ingress + provision gates |
| `scripts/trial-expiry-sweep.cjs` | Expiry / inactivity release |
| `routes/signup.js` | Phone verify + attribution |


---

<a id="prod-db-parity"></a>

## PROD DB PARITY

*Merged from `docs/deployment/PROD_DB_PARITY.md` on 2026-06-02.*

# Production database parity (embeddings, MPFS, NPPES taxonomy)

Dev SQLite (`middleware-dev.db`) is the reference. Replicate these counts on production before relying on semantic search, voice coding, or fee/taxonomy features.

| Table / asset | Dev target count | How to build |
|---------------|------------------|--------------|
| `icd10_codes` | ~74,260 | `node scripts/import-icd10-codes.js` |
| `cpt_codes` | **~17,170** (Medicare PFS) | `node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv` |
| `hcpcs_codes` | ~9,006 | `node scripts/import-hcpcs-codes.js` |
| `code_embeddings` | ~100,000+ | `populate-code-embeddings.js --until-done` (CPT incremental after MPFS import) |
| `fee_schedules` (MPFS) | ~15,272 | `node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv` |
| `provider_taxonomy_links` | ~1.76M | `npm run payor:npi-dedup-directory` after `nppes_directory_providers` load |

**Do not use DHS-only CPT import on production** (~1,299 rows, missing 99202–99215 E/M).

## Option A — Copy dev DB to prod host

```bash
# On dev machine (stop writers first)
cd middleware-platform
sqlite3 middleware-dev.db ".backup 'middleware-prod-seed.db'"

# Upload to Render persistent disk / prod server, set SQLITE_PATH or DATABASE_URL
```

## Option B — Re-run imports on prod

From `middleware-platform/` on the production host (with CMS files under `Knowledge/`):

```bash
export SKIP_STARTUP_MIGRATIONS=1
node scripts/import-icd10-codes.js
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/import-hcpcs-codes.js
node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/populate-code-embeddings.js --type cpt --incremental --until-done --batch-size 5000
node scripts/populate-code-embeddings.js --until-done --batch-size 5000
npm run payor:npi-dedup-directory
```

## Verify

```bash
npm run verify:prod-codebook
# or manually:
sqlite3 "$DATABASE_PATH" "
  SELECT 'cpt_codes', COUNT(*) FROM cpt_codes
  UNION ALL SELECT 'cpt_emb', COUNT(*) FROM code_embeddings WHERE code_type='cpt'
  UNION ALL SELECT 'embeddings', COUNT(*) FROM code_embeddings WHERE embedding_json IS NOT NULL
  UNION ALL SELECT 'mpfs', COUNT(*) FROM fee_schedules;
"
```

Expected: `cpt_codes` ≥ 15,000; `cpt_emb` should match `cpt_codes` count.

## Render env (coding)

| Variable | Production value |
|----------|------------------|
| `SEMANTIC_SEARCH_ENABLED` | `true` |
| `RAG_API_URL` | `disabled` (use live Pinecone via `PINECONE_*`; do not default to localhost) |
| `REMOTE_RAG_TIMEOUT_MS` | `2000` (voice dual-source remote leg) |
| `PINECONE_API_KEY` / `PINECONE_INDEX_HOST` | Set per [MEDICAL_CODEBOOK_SETUP.md](./MEDICAL_CODEBOOK_SETUP.md) |

See [RENDER_PRODUCTION_CHECKLIST.md](./RENDER_PRODUCTION_CHECKLIST.md).


---

<a id="medical-codebook-setup"></a>

## MEDICAL CODEBOOK SETUP

*Merged from `docs/deployment/MEDICAL_CODEBOOK_SETUP.md` on 2026-06-02.*

# Medical codebook setup (local dev)

## Pinecone API key rotation

If `PINECONE_API_KEY` was exposed in logs, chat, or shared docs:

1. [Pinecone console](https://app.pinecone.io/) → API keys → revoke the old key.
2. Create a new key and set it in `middleware-platform/.env` and Render env for `medical-rag-api` (Flask RAG).
3. Set `PINECONE_INDEX_HOST` for middleware direct-query fallback.
4. Never commit `.env`.

## CMS files (repo paths)

| Code set | Path |
|----------|------|
| ICD-10-CM FY2025 | `Knowledge/ICD-10 Files/FY2025 Code Descriptions/icd10cm-codes-2025.txt` (CDC zip) |
| **CPT (Medicare PFS — recommended)** | `Knowledge/fee-schedules/RVU26A.csv` or `PPRRVU.csv` from [CMS RVU26A](https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files/rvu26a) |
| CPT (DHS subset only, legacy) | `Knowledge/CPT/2025_DHS_Code_List_Addendum_11_26_2024.xlsx` (~1,299 codes; **no** 99213/99214 E/M) |
| HCPCS 2026 | `Knowledge/HCPCS/hcpc2026_jan_anweb_01122026/HCPC2026_JAN_ANWEB_01122026.txt` |

Download FY2025 ICD: https://ftp.cdc.gov/pub/health_statistics/nchs/Publications/ICD10CM/2025/ICD10-CM%20Code%20Descriptions%202025.zip

## Import order

From `middleware-platform/`:

```bash
node scripts/import-icd10-codes.js
# CPT: use Medicare Physician Fee Schedule (not DHS-only) so E/M codes 99202–99215 exist
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
# After RVU26A download: node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/RVU26A.csv
node scripts/import-hcpcs-codes.js
node scripts/populate-code-embeddings.js --type cpt --incremental --until-done --batch-size 5000
node scripts/populate-code-embeddings.js --until-done --batch-size 5000   # full icd+hcpcs if first run
```

**CPT vs fee schedules:** `import-cpt-codes.js --source mpfs` fills `cpt_codes` (descriptions for coding search). `import-mpfs-medicare.js` fills `fee_schedules` (allowed amounts). E/M rows often have $0 in the RVU payment columns and may be skipped from fees but are still imported into `cpt_codes`.

### Semantic search (voice + local coding)

Set before relying on embeddings in production (eval also benefits from parity with voice):

```bash
SEMANTIC_SEARCH_ENABLED=true
```

### Background / unattended embeddings (macOS)

```bash
npm run embeddings:daemon
npm run embeddings:daemon:status
npm run embeddings:daemon:stop
```

Log: `middleware-platform/tmp/embeddings-daemon.log`

### Accuracy eval + CPT audit

```bash
# Fast regression (keyword + phrase + dual-source; matches voice default)
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding
npm run audit:eval-cpt
npm run verify:prod-codebook
```

Report: `tmp/coding-accuracy-report.json`. Run `npm run audit:eval-cpt` to confirm expected CPTs exist in `cpt_codes` before blaming retrieval logic.

### Remote coding (Pinecone, no static export)

Voice and eval use `getCodeCandidatesDualSource`: local SQLite + live **Pinecone** (`pinecone-code-metadata-client`). Do not require `Knowledge/RAG/knowledge_export.json`. Set `RAG_API_URL=disabled` in production unless a Colab Flask proxy is explicitly deployed.

Lay-language phrase maps: `Knowledge/rules/lay-language-icd-expansions.json`. ICD term fixes: `Knowledge/RAG/icd10_term_corrections.json`.

Production env: [RENDER_PRODUCTION_CHECKLIST.md](./RENDER_PRODUCTION_CHECKLIST.md). DB parity: [PROD_DB_PARITY.md](./PROD_DB_PARITY.md).

## Stedi claim type (837P vs 837I)

Telehealth professional claims require **837P** submission. Default in code is `institutional` until you switch:

```bash
STEDI_CLAIM_SUBMISSION_MODE=professional
```

Set in `.env` before production claim submit. See `InsuranceService.getStediClaimSubmissionMode()` in `services/insurance-service.js`.

## Stedi claim-status webhook

Register in the [Stedi dashboard](https://www.stedi.com/) (production):

`https://api.callsomo.com/webhooks/stedi/claim-status`

Set `STEDI_WEBHOOK_SECRET` in Render/middleware `.env` to match Stedi if HMAC verification is enabled. Handler: `routes/stedi-webhooks.js`.

**Checklist (ops):**

1. Create webhook in Stedi → URL above → copy signing secret.
2. Render middleware service → Environment → `STEDI_WEBHOOK_SECRET` = signing secret.
3. Redeploy middleware.
4. `npm run verify:stedi-env` on prod host (optional).
5. Submit a test claim status event in Stedi; confirm `code_acceptance_rates` updates in logs/DB.

## NPPES directory → provider taxonomy

After `nppes_directory_providers` is populated (~1.7M rows):

```bash
node scripts/run-provider-registry-npi-dedup.cjs --include-directory --directory-all
# or: npm run payor:npi-dedup-directory
```

## MPFS fee schedules

```bash
# Download CMS PFS CSV, then:
node scripts/import-mpfs-medicare.js --file /path/to/PPRRVU.csv
```

## Ops scripts

```bash
node scripts/resubmit-telehealth-claims.cjs              # dry-run
node scripts/resubmit-telehealth-claims.cjs --execute
node scripts/run-provider-registry-npi-dedup.cjs --limit 50000
node scripts/poll-claim-statuses.cjs --hours 24
npm run eval:coding
```

Verify:

```bash
sqlite3 data/middleware-dev.db "SELECT COUNT(*) FROM icd10_codes; SELECT COUNT(*) FROM cpt_codes; SELECT COUNT(*) FROM hcpcs_codes;"
```

## Flask RAG CPT fix (Render)

Deploy the handler patch from `Knowledge/RAG/flask-retrieve-cpt-patch.py` into `medical-rag-api` `/api/retrieve` so `cpt_codes` chunk metadata is aggregated like ICD.


---

<a id="edge-routing-configs"></a>

## EDGE ROUTING CONFIGS

*Merged from `docs/deployment/EDGE_ROUTING_CONFIGS.md` on 2026-06-02.*

# Edge Routing Configs for `callsomo.com`

Use **one** pattern in production. Do not mix patterns without understanding the trade-offs.

## Current production (split-domain)

**Authoritative layout:**

| Role | Host | Serves |
|------|------|--------|
| Marketing / SPA | `https://callsomo.com` | Firebase Hosting (`unified-dashboard/firebase.json` → `somo-landing/build`) |
| Middleware API | `https://api.callsomo.com` | Google **Cloud Run** (custom domain mapping + TLS) |

The landing build must target the API host explicitly:

- **`deploy:landing-hosting`** builds `somo-landing` and deploys to Firebase (same-origin API calls go to `api.callsomo.com` via browser on split-domain).

### Why `https://callsomo.com/api/*` returns HTML

Firebase Hosting rewrites unknown paths to `/index.html` for the SPA. There is **no** `/api` proxy on the UI host in the default split-domain setup, so `GET/POST …/api/…` on the **marketing domain** returns HTML, not JSON. That is **expected**; clients and tests must call **`https://api.callsomo.com`** for API routes.

To validate JSON on the UI domain, add an edge same-domain proxy (Option A) and set `PROD_ROUTING_MODE=same-domain` for smoke checks (below).

---

## Option A: Cloudflare (or similar) — same-domain `/api/*` proxy

Use when you want `https://callsomo.com/api/*` to hit middleware without changing the SPA origin.

### DNS (example)

- `callsomo.com` → frontend (proxied)
- `api.callsomo.com` → API origin (proxied), or omit if everything goes through the Worker

### Cloudflare Worker (route: `callsomo.com/api/*`)

See `infra/edge-routing/cloudflare/myskin-api-proxy/` — backend defaults to `https://api.callsomo.com`.

Result: same-domain `https://callsomo.com/api/*` reaches the API origin.

---

## Option B: Nginx reverse proxy (single host)

```nginx
server {
  listen 443 ssl http2;
  server_name callsomo.com;

  location / {
    proxy_pass https://<frontend-origin>;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /api/ {
    proxy_pass https://api.callsomo.com;
    proxy_http_version 1.1;
    proxy_set_header Host api.callsomo.com;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Adjust `proxy_set_header Host` if your middleware expects the original browser host.

---

## Option C: Firebase Hosting + dedicated API host (split-domain) — **current default**

Firebase Hosting cannot arbitrarily reverse-proxy to an arbitrary external API in `firebase.json` rewrites alone. Split-domain keeps hosting simple:

- **Frontend:** `https://callsomo.com` (Firebase Hosting)
- **Backend:** `https://api.callsomo.com` (Cloud Run + [custom domain mapping](https://cloud.google.com/run/docs/mapping-custom-domains))
- **DNS:** Use the records Google Cloud shows for the mapped domain (often includes targets such as `ghs.googlehosted.com` or static IPs, depending on the mapping type).

### Firebase config (SPA fallback)

`unified-dashboard/firebase.json` — keep the catch-all rewrite to `index.html` for client routing.

---

## Option D: Single ingress (e.g. Railway-only)

If one platform serves both static and API with path routing (`/api/*` → middleware, `/*` → frontend), document that stack’s ingress rules here. This is **not** the current `callsomo.com` production path.

---

## Mandatory checks after changes

### 1. API host (always)

```bash
curl -sS -i https://api.callsomo.com/health
curl -sS -i -X POST https://api.callsomo.com/api/public/landing-assistant/turn \
  -H "content-type: application/json" \
  -d '{"session_id":"routing_probe","message":"hello"}'
```

Expect JSON bodies and `content-type` consistent with JSON, not `text/html`.

### 2. Same-domain proxy (only if you deployed Option A / B)

```bash
curl -sS -i https://callsomo.com/api/health
```

### 3. Routing smoke (`middleware-platform`)

Default mode is **split-domain** (`PROD_ROUTING_MODE` defaults to `split-domain`): same-domain `/api/*` checks are **skipped**; the script validates the UI is up and that **`MIDDLEWARE_API_BASE`** returns JSON for `/health` and the landing-assistant turn.

```bash
UI_BASE_URL=https://callsomo.com \
MIDDLEWARE_API_BASE=https://api.callsomo.com \
npm run verify:prod:routing-smoke --prefix middleware-platform
```

To require JSON on the **UI** origin for `/api/*`, set:

```bash
PROD_ROUTING_MODE=same-domain
```

### 4. Full prod E2E signoff

Uses the Playwright full scan/chat flow against real prod URLs. Point the API at the middleware host (not the marketing domain):

```bash
PLAYWRIGHT_BROWSERS_PATH=0 \
UI_BASE_URL=https://callsomo.com \
MIDDLEWARE_API_BASE=https://api.callsomo.com \
npm run verify:prod:full-e2e-signoff --prefix middleware-platform
```

The underlying script is `scripts/playwright-full-scan-chat-e2e.cjs`; it reads `UI_BASE_URL` and `MIDDLEWARE_API_BASE` from the environment.

**Note:** Occasional **429** responses on assistant turns are rate-limiting, not routing bugs. Retry or backoff if a gate flakes under load.


---

<a id="render-production-checklist"></a>

## RENDER PRODUCTION CHECKLIST

*Merged from `docs/deployment/RENDER_PRODUCTION_CHECKLIST.md` on 2026-06-02.*

# Render production checklist (`api.callsomo.com`)

Apply these in the **middleware** Render service environment before live claim submit.

## Required env vars

| Variable | Value | Why |
|----------|--------|-----|
| `STEDI_CLAIM_SUBMISSION_MODE` | `professional` | 837P `professionalclaims` (not institutional 837I) |
| `SEMANTIC_SEARCH_ENABLED` | `true` | Voice + local coding use hybrid semantic search over `code_embeddings` |
| `RAG_API_URL` | `disabled` | Use live Pinecone metadata (`PINECONE_*`); do **not** leave unset (old default was `localhost:4000`) |
| `REMOTE_RAG_TIMEOUT_MS` | `2000` | Cap Pinecone/remote leg for `suggest_codes_from_symptoms` (3s tool budget) |
| `STEDI_WEBHOOK_SECRET` | (from Stedi dashboard) | HMAC verification on `/webhooks/stedi/claim-status` |

Also set: `OPENAI_API_KEY`, `STEDI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX_HOST` as in dev.

**Production DB:** Run MPFS CPT import + embeddings on prod before go-live — see [PROD_DB_PARITY.md](./PROD_DB_PARITY.md). Verify with `npm run verify:prod-codebook` on the prod host.

## Stedi dashboard (manual)

1. [Stedi](https://www.stedi.com/) → webhooks → add endpoint:
   - `https://api.callsomo.com/webhooks/stedi/claim-status`
2. Copy signing secret into Render as `STEDI_WEBHOOK_SECRET`.
3. Redeploy middleware after env changes.

## Verify after deploy

```bash
# Health (replace host if different)
curl -s https://api.callsomo.com/health

# Logs: must NOT show institutional Stedi warning on startup
```

Optional on prod host:

```bash
node scripts/poll-claim-statuses.cjs --hours 24
node scripts/resubmit-telehealth-claims.cjs          # dry-run first
node scripts/resubmit-telehealth-claims.cjs --execute  # only after 837P + webhook live
```

## Production DB parity

Dev SQLite already has:

- 84,565 `code_embeddings`
- 15,272 `fee_schedules` (MPFS)
- 1.76M `provider_taxonomy_links` from `nppes_directory`

Replicate on production DB (dump/restore or re-run scripts in [MEDICAL_CODEBOOK_SETUP.md](./MEDICAL_CODEBOOK_SETUP.md)):

```bash
npm run embeddings:daemon
node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
npm run payor:npi-dedup-directory
```


---

<a id="retell-agent-inventory"></a>

## retell-agent-inventory

*Merged from `docs/deployment/retell-agent-inventory.md` on 2026-06-02.*

# Retell agent inventory (`retell-agent-inventory.json`)

The JSON file [`retell-agent-inventory.json`](./retell-agent-inventory.json) is the **machine-readable source of truth** for verifying that production Retell agents match repo expectations.

## Used by

```bash
cd middleware-platform
npm run verify:agent-config
# or: RETELL_API_KEY=... node scripts/verify-agent-config.cjs
```

Script: [`middleware-platform/scripts/verify-agent-config.cjs`](../../middleware-platform/scripts/verify-agent-config.cjs)

## What it checks

| Field | Purpose |
|-------|---------|
| `canonical.websocket_path` | Agent `llm_websocket_url` must end with `/webhook/retell/llm` |
| `canonical.required_tools` | Tool names present on agent (best-effort) |
| `canonical.prompt_markers` | Substrings expected in agent prompt |
| `agents[].agent_id` | List of agent IDs to fetch from Retell API |

## Updating

When you add or change the production Kelly agent:

1. Add an entry under `agents` with `agent_id` and a short `label`.
2. Run `node configure-retell.js` with `API_BASE_URL=https://api.callsomo.com`.
3. Run `npm run verify:agent-config` and fix any drift.

See also: [`VOICE_CURRENT_ARCHITECTURE.md`](./VOICE_CURRENT_ARCHITECTURE.md).


---

<a id="retell-agent-inventory"></a>

## RETELL AGENT INVENTORY

*Merged from `docs/deployment/RETELL_AGENT_INVENTORY.md` on 2026-06-02.*

# Retell agent inventory (redirect)

**Superseded.** Canonical docs:

- **How to verify:** [`retell-agent-inventory.md`](./retell-agent-inventory.md)
- **Machine-readable list:** [`retell-agent-inventory.json`](./retell-agent-inventory.json)
- **Command:** `cd middleware-platform && npm run verify:agent-config`


---

<a id="gcp-deploy-rollback"></a>

## GCP DEPLOY ROLLBACK

*Merged from `docs/deployment/GCP_DEPLOY_ROLLBACK.md` on 2026-06-02.*

# GCP deploy and rollback (redirect)

**Superseded.** Use the operational runbook:

→ **[`docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)**

Staging/production hosts: **[`docs/runbooks/CALLSOMO_GCP_CUTOVER.md`](../runbooks/CALLSOMO_GCP_CUTOVER.md)**
