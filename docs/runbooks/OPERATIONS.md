# OPERATIONS

**Last updated:** 2026-06-02


---

<a id="callsomo-gcp-cutover"></a>

## CALLSOMO GCP CUTOVER

*Merged from `docs/runbooks/CALLSOMO_GCP_CUTOVER.md` on 2026-06-02.*

# callsomo.com GCP cutover (project `somo-callsomo`)

**Status (2026-06-14):** Use the verification checklist below — do not assume `api.callsomo.com` is live until smoke passes. Primary deploy path: **`npm run deploy:callsomo`** — see [`FRONT_DESK_PRODUCTION.md`](../deployment/FRONT_DESK_PRODUCTION.md).

| Project | ID | Role |
|---------|-----|------|
| GCP (API / Cloud Run / billing) | **`somo-callsomo`** | `somo-middleware`, secrets, `api.callsomo.com` |
| Firebase (Hosting UI) | **`somo-4ddf6`** | `callsomo.com` static site — [.firebaserc](../../unified-dashboard/.firebaserc) |

ID `somo` alone is too short for GCP (min 6 characters).

| Role | URL |
|------|-----|
| UI | `https://callsomo.com` |
| API | `https://api.callsomo.com` |
| Cloud Run URL (direct) | `gcloud run services describe somo-middleware --region=us-central1 --project=somo-callsomo --format='value(status.url)'` |

## Local gcloud and ADC

CLI account and **Application Default Credentials** are separate. Scripts using `google-auth-library` read ADC from `~/.config/gcloud/application_default_credentials.json`, not the active `gcloud` account.

Use **`richard@callsomo.com`** for both (not `richard@callsomo.com`):

```bash
gcloud config set account richard@callsomo.com
gcloud config set project somo-callsomo
gcloud auth application-default login   # browser — sign in as richard@callsomo.com
gcloud auth application-default set-quota-project somo-callsomo
```

Verify ADC email:

```bash
curl -sS "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=$(gcloud auth application-default print-access-token)" | grep email
```

If quota-project update fails with `serviceusage.services.use`, the ADC file is still on the wrong Google account — revoke and log in again:

```bash
gcloud auth application-default revoke
gcloud auth application-default login
```

Remove legacy CLI account after switching:

```bash
gcloud auth revoke richard@callsomo.com
gcloud auth list   # should show only richard@callsomo.com
```

## 1. DNS for API

**Order:** create the Cloud Run domain mapping **first**, then add DNS.

1. Deploy `somo-middleware` (production profile).
2. Create mapping:
   ```bash
   gcloud beta run domain-mappings create --service=somo-middleware \
     --domain=api.callsomo.com --region=us-central1 --project=somo-callsomo
   ```
3. At the registrar, add:

| Name | Type | Value |
|------|------|--------|
| `api` | CNAME | `ghs.googlehosted.com` |

Verify mapping before or after DNS propagates:

```bash
gcloud beta run domain-mappings describe --domain=api.callsomo.com \
  --region=us-central1 --project=somo-callsomo
curl -sS -o /dev/null -w '%{http_code}\n' https://api.callsomo.com/health/live
```

## 2. Firebase Hosting (UI)

Firebase Hosting project **`somo-4ddf6`** serves **`callsomo.com`** (verify with `npm run gcp:bootstrap:check`). As `richard@callsomo.com`:

1. [Firebase Console](https://console.firebase.google.com/) → project **`somo-4ddf6`** → Hosting.
2. Custom domain **`callsomo.com`** — DNS A `199.36.158.100`, TXT `hosting-site=somo-4ddf6`.
3. Deploy from repo:

```bash
firebase logout
firebase login   # sign in as richard@callsomo.com
npm run build:staging-hosting
cd unified-dashboard && firebase deploy --only hosting --project somo-4ddf6
```

4. Hosting → **Add custom domain** `callsomo.com` and add Firebase DNS records at your registrar.

## 3. Org policy: public Cloud Run

The org may block `allUsers` as `roles/run.invoker`. Symptom: **403** on `api.callsomo.com` without auth.

**Preferred fix (works when `iam.allowedPolicyMemberDomains` blocks `allUsers`):**

```bash
./scripts/ensure-cloudrun-public-invoker.sh
```

This grants `allUsers` `roles/run.invoker` when allowed; otherwise it runs:

```bash
gcloud run services update somo-middleware --region=us-central1 --project=somo-callsomo --no-invoker-iam-check
```

[`scripts/deploy-to-gcp.sh`](../../scripts/deploy-to-gcp.sh) passes `--no-invoker-iam-check` on deploy so new revisions stay public.

**Alternative:** Org admin relaxes `constraints/iam.allowedPolicyMemberDomains` for project `somo-callsomo`, or HTTPS Load Balancing in front of Cloud Run.

Authenticated health check:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$(gcloud run services describe somo-middleware --region=us-central1 --project=somo-callsomo --format='value(status.url)')/health/live"
```

## 4. Deploy / update API

```bash
export GCP_PROJECT=somo-callsomo USE_GCP_SECRETS=1 \
  CLOUDRUN_BASE_URL=https://api.callsomo.com \
  GCS_DB_BUCKET=somo-staging-db-somo-callsomo CLOUDRUN_PROFILE=staging
./scripts/deploy-to-gcp.sh
```

Or run [`scripts/bootstrap-somo-gcp.sh`](../../scripts/bootstrap-somo-gcp.sh).

## 5. Webhooks (operator)

Automated sync (Twilio voice URL + Retell agent WSS + DNS/HTTP checks):

```bash
# From repo root; requires middleware-platform/.env (TWILIO_*, RETELL_API_KEY)
npm run callsomo:operator-sync

# Include Firebase UI rebuild + deploy (project somo-4ddf6)
npm run callsomo:operator-sync -- --deploy-ui
```

Set `CALLSOMO_VOICE_CUSTOMER_ID=cust_...` if your Twilio number has no `customer_id` in the current webhook URL.

Manual targets:

- Twilio voice URL: `https://api.callsomo.com/voice/incoming?customer_id={OWNER_CUSTOMER_ID}`
- Retell LLM WSS: `wss://api.callsomo.com/webhook/retell/llm`
- Stripe / Stedi: `https://api.callsomo.com/...` webhooks

## 6. Staging database (GCS)

Old project `doctor-little-c688d` has **billing closed**, so `gs://somo-staging-db/` cannot be read. New bucket: `gs://somo-staging-db-somo-callsomo/` (fresh DB on first boot unless you restore a local copy).

If you have a local backup:

```bash
gsutil cp ./middleware-staging.db gs://somo-staging-db-somo-callsomo/middleware-staging.db
```

Then redeploy Cloud Run or restart the revision.

## Terminal helper script

From repo root:

```bash
npm run callsomo:check          # DNS + HTTP status
npm run callsomo:operator-sync  # Twilio + Retell + DNS checks (add --deploy-ui to deploy)
npm run callsomo:deploy-api     # Cloud Run
npm run callsomo:deploy-ui      # Firebase somo-4ddf6 (not GCP project id)
npm run callsomo:e2e-smoke      # Playwright smoke (uses run.app + identity token if API DNS down)
npm run callsomo:e2e-full       # Full Playwright suite
```

## 7. Playwright E2E (callsomo.com)

Install browsers once: `cd middleware-platform && npx playwright install chromium`

| Variable | Purpose |
|----------|---------|
| `TRIAL_E2E_PHONE` | Twilio Verify handset |
| `STAGING_EMAIL_CODE` / `STAGING_SMS_CODE` | OTP for signup-api / signup UI |
| `STAGING_DB_PATH` | Local staging SQLite for DB asserts |
| `GCS_DB_BUCKET` | `somo-staging-db-somo-callsomo` for email code sync |

```bash
npm run gcp:bootstrap:check
npm run verify:prod:routing-smoke --prefix middleware-platform
npm run test:e2e:callsomo:smoke --prefix middleware-platform
npm run test:e2e:callsomo --prefix middleware-platform   # full suite
```

**DNS:** `callsomo.com` must point to Firebase Hosting (not Squarespace). `api.callsomo.com` must CNAME `ghs.googlehosted.com`.

**Org policy blocks public Cloud Run:** use identity token for API smoke:

```bash
export PW_API_BASE_URL="$(gcloud run services describe somo-middleware --region=us-central1 --project=somo-callsomo --format='value(status.url)')"
export PLAYWRIGHT_API_BEARER="$(gcloud auth print-identity-token)"
npm run test:e2e:callsomo:smoke --prefix middleware-platform
```

## 8. Retire legacy

After 24–48h on callsomo.com:

1. 301 `callsomo.com` → `https://callsomo.com`
2. Remove domain mappings on `doctor-little-c688d`
3. Disable billing on old project if unused


---

<a id="gcp-deploy-rollback-runbook"></a>

## GCP DEPLOY ROLLBACK RUNBOOK

*Merged from `docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md` on 2026-06-02.*

# GCP deploy and rollback runbook

> **Last reviewed:** 2026-05-27

Production layout for **callsomo.com** (split-domain). Authoritative routing detail: [`docs/deployment/EDGE_ROUTING_CONFIGS.md`](../deployment/EDGE_ROUTING_CONFIGS.md).

## Architecture

| Role | Host | Platform |
|------|------|----------|
| Marketing SPA | `https://callsomo.com` | Firebase Hosting |
| Middleware API | `https://api.callsomo.com` | Google Cloud Run |

Landing builds must set `VITE_API_BASE=https://api.callsomo.com` before `npm run build`.

## CI vs live deploy

- **CI:** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs tests on push/PR. **Production deploy:** local — `npm run deploy:callsomo` (Firebase UI + Cloud Run API). Railway is deprecated.
- **Operational source of truth:** Cloud Run `somo-middleware` + Firebase Hosting + GCP Secret Manager. See [`SOMO_CLOUD_RUN_DEPLOY.md`](../deployment/SOMO_CLOUD_RUN_DEPLOY.md).

See [deployment README § CI and deployment](../deployment/README.md#ci-and-deploy-source-of-truth).

## Pre-deploy checklist

1. PR passes CI (`CONTRIBUTING.md` local parity).
2. Medical codebook on prod host if coding release: [`PROD_DB_PARITY.md`](../deployment/PROD_DB_PARITY.md), `npm run verify:prod-codebook`.
3. Env vars per [`ENVIRONMENT_VARIABLES_BY_SURFACE.md`](../setup/ENVIRONMENT_VARIABLES_BY_SURFACE.md) and [`RENDER_PRODUCTION_CHECKLIST.md`](../deployment/RENDER_PRODUCTION_CHECKLIST.md) (Stedi, Pinecone, `RAG_API_URL=disabled`).

## Deploy (typical)

### API (Cloud Run)

1. Build and push container (team-specific pipeline; see infra docs in repo root).
2. Deploy new revision to Cloud Run service backing `api.callsomo.com` (`./scripts/deploy-to-gcp-production.sh` until domain cutover; then `CLOUDRUN_SERVICE=somo-middleware`).
3. Verify:

```bash
curl -sS -i https://api.callsomo.com/health
curl -sS -i https://api.callsomo.com/api/public/somo-demo/health
curl -sS -i -X POST https://api.callsomo.com/api/public/landing-assistant/turn \
  -H 'content-type: application/json' -d '{"session_id":"rollback-smoke","message":"hello"}'
npm run verify:prod:routing-smoke --prefix middleware-platform
```

### Landing (Firebase Hosting)

```bash
cd unified-dashboard/somo-landing
VITE_API_BASE=https://api.callsomo.com npm run build
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
curl -sS -o /dev/null -w 'health_live:%{http_code}\n' https://api.callsomo.com/health/live

# Retell LLM HTTP probe
curl -sS -o /dev/null -w 'retell_llm:%{http_code}\n' https://api.callsomo.com/webhook/retell/llm

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
2. Confirm SPA loads and API calls hit `api.callsomo.com` (not marketing host `/api/*` — that returns HTML by design on split-domain).

## When things go wrong

| Symptom | Check |
|---------|--------|
| `/api/*` on marketing domain returns HTML | Expected on split-domain; fix client `VITE_API_BASE` |
| Coding regressions | [`Medical Coding/OPERATIONS.md`](../Medical%20Coding/OPERATIONS.md) — eval + codebook verify |
| Stedi claims stuck | [`runbooks/STEDI_DOWN`](./README.md#stedi-down) anchor in consolidated runbooks |
| `429 Rate exceeded.` on `/health` or webhooks (body length 14, `server: Google Frontend`) | **Cloud Run scaling**, not app middleware. Log: `The request was aborted because there was no available instance` in `run.googleapis.com/requests`. Increase `min-instances`, lower `concurrency`, ensure startup probe `/health/live`, check revision crash/OOM. |
| Retell outbound `not_connected` + `telephony_provider_permission_denied` | **Retell↔Twilio SIP trunk auth** for `create-phone-call` path. Align termination URI + credential username/password in Retell with live Twilio SIP domain/trunk. Use Twilio-direct outbound (`make-outbound-call.js`) as operational workaround. See [`VOICE_CURRENT_ARCHITECTURE.md`](../deployment/VOICE_CURRENT_ARCHITECTURE.md). |
| Inbound connects but no agent / fallback TwiML | Check Cloud Run logs for Retell `register-phone-call` 400 (e.g. `merchant_id must be string`). Ensure dynamic variables are strings; omit null fields. |
| `error_llm_websocket_open` on Retell calls | Confirm agent `llm_websocket_url` = `wss://api.callsomo.com/webhook/retell/llm` and `RETELL_LLM_WEBSOCKET_URL` on Cloud Run; run `node configure-retell.js`. |


---

<a id="prod-monitoring-workflows"></a>

## PROD MONITORING WORKFLOWS

*Merged from `docs/runbooks/PROD_MONITORING_WORKFLOWS.md` on 2026-06-02.*

# Production monitoring workflows

> **Last reviewed:** 2026-05-25

What actually runs today for prod health — no invented scheduled jobs.

## GitHub Actions (on push to main/master)

From [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml):

| Step | Job | Purpose |
|------|-----|---------|
| Jest + reasoning gates | `test` | Unit/regression on every PR/push |
| `npm run verify:prod:routing-smoke` | `deploy` | Prod URL routing check after merge to main |
| Heuristic secret grep | `security` | Best-effort; not full secret scanning |

There is **no** dedicated scheduled workflow in-repo for nightly Playwright against prod. Run prod browser tests **manually** when needed.

## Manual prod checks

From `middleware-platform/`:

```bash
# Routing / API reachability (same as CI deploy job)
npm run verify:prod:routing-smoke

# Browser smoke (requires playwright.prod.config.cjs)
UI_BASE_URL=https://callsomo.com \
MIDDLEWARE_API_BASE=https://api.callsomo.com \
npm run test:prod:smoke
```

Full matrix: [PROD_PLAYWRIGHT_SUITES.md](../testing/PROD_PLAYWRIGHT_SUITES.md).

## Medical coding regression

Not in CI deploy job by default. Before coding releases:

```bash
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding
npm run verify:prod-codebook
```

See [Medical Coding/OPERATIONS.md](../Medical%20Coding/OPERATIONS.md).

## Payor ingest signals

Optional webhook: `PAYOR_INGEST_METRICS_WEBHOOK_URL` in middleware `.env`. Operator runbooks:

- [`PAYOR_INGEST_FAILURE_RECOVERY.md`](./PAYOR_INGEST_FAILURE_RECOVERY.md)
- [`PAYOR_BATCH_REPROCESSING.md`](./PAYOR_BATCH_REPROCESSING.md)

## Recommended org-level monitoring

- GitHub Advanced Security secret scanning
- Cloud Run metrics + alerting (latency, 5xx)
- Firebase Hosting uptime
- External uptime on `https://api.callsomo.com/health`

Secret hygiene: [SECRET_SCANNING.md](../security/SECRET_SCANNING.md).

## Related consolidated runbooks

Incident playbooks (Stripe, Stedi, reasoning, DLQ): [`docs/runbooks/README.md`](./README.md).


---

<a id="voice-inbound-troubleshooting"></a>

## voice-inbound-troubleshooting

*Merged from `docs/runbooks/voice-inbound-troubleshooting.md` on 2026-06-02.*

# Voice inbound troubleshooting

> **Last reviewed:** 2026-05-30  
> **When:** Call connects but is silent, wrong tenant, or no `voice_call_log` row.

## Path

```text
Caller → Twilio DID → POST /voice/incoming?customer_id=…
       → TwiML / Retell bridge
       → Retell agent → WebSocket retell-websocket.js
       → Kelly / tools → voice_call_log, voice_call_states
```

## Checklist (in order)

### 1. Twilio

- [ ] Voice URL matches `{PUBLIC_URL}/voice/incoming?customer_id={EXPECTED_ID}`
- [ ] `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` loaded (middleware boot)
- [ ] `customers.twilio_phone_number` and `twilio_phone_sid` set for owner
- [ ] Signature validation: if 403, check `TWILIO_WEBHOOK_SIGNATURE_REQUIRED` and public URL

### 2. Public URL

- [ ] `API_BASE_URL` or `NGROK_URL` is HTTPS and reachable from internet
- [ ] Middleware restarted after env change
- [ ] `curl -s "$PUBLIC/health"` returns 200

### 3. Tenant resolution

- [ ] Middleware logs show `customer_id` = owner (not default / akin-dunbar)
- [ ] Query: `SELECT customer_id, call_id FROM voice_call_log ORDER BY created_at DESC LIMIT 5`

### 4. Retell

- [ ] `customers.retell_agent_id` present
- [ ] Retell dashboard agent webhook / WS points to same public host as middleware
- [ ] `RETELL_API_KEY` set; no 401 in logs
- [ ] If WS disconnects: confirm `customer_id` on `voice_call_states` after W2-01

### 5. Kelly / LLM

- [ ] `KELLY_PRIMARY_PROVIDER` keys present if expecting LLM replies
- [ ] Groq/Anthropic circuit not open for all providers

## SQL snippets

```sql
SELECT id, email, twilio_phone_number, retell_agent_id, merchant_id
FROM customers WHERE id = ?;

SELECT call_id, customer_id, created_at FROM voice_call_log
ORDER BY created_at DESC LIMIT 10;
```

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](../Database/SOMO_FOUNDATION_RUNBOOK.md)
- [ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md)


---

<a id="trial-lifecycle"></a>

## trial-lifecycle

*Merged from `docs/runbooks/trial-lifecycle.md` on 2026-06-02.*

# Trial lifecycle (W4-02)

> **Last reviewed:** 2026-05-29

## States

| `trial_status` | Meaning |
|----------------|---------|
| `pending` | Signup started, phone may be unverified |
| `active` | Trial running; requires `phone_verified=1` |
| `exhausted` | Minutes/credits used up |
| `expired` | Past `trial_expires_at` |

## Sweeps

```bash
cd middleware-platform
npm run trial:expiry-sweep          # dry-run
npm run trial:expiry-sweep:apply    # apply
```

## Gates

- `phone_verified=1` required before `trial_status=active` (see `trial-lifecycle.js` `activateTrialRecord`).
- Dedicated Twilio line provisioned via `startTrialTenant`.

## Related

- [ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md)
- [SOMOPAY_SCOPE.md](../product/SOMOPAY_SCOPE.md)


---

<a id="wipe-tenant-data"></a>

## wipe-tenant-data

*Merged from `docs/runbooks/wipe-tenant-data.md` on 2026-06-02.*

# Wipe tenant data (dev)

> **Last reviewed:** 2026-05-29  
> **Hygiene:** H-02

## Order (always)

External providers first — otherwise webhooks and billing keep firing for deleted rows.

1. **Stripe** — cancel subscriptions / delete test customers for tenant
2. **Twilio** — release or reassign phone numbers; clear webhooks if reusing SID
3. **Retell** — delete or unlink agent if dedicated per tenant
4. **Database** — delete tenant rows (customers → dependent tables)

## Dev script

```bash
cd middleware-platform
ALLOW_DEV_WIPE=1 node scripts/wipe-dev-tenants.cjs --customer-id=<id> --dry-run
ALLOW_DEV_WIPE=1 node scripts/wipe-dev-tenants.cjs --customer-id=<id>
```

`ALLOW_DEV_WIPE=1` is required; script refuses production `NODE_ENV`.

## Purge test accounts only

```bash
npm run db:purge-test-tenants
```

Removes smoke/trial-e2e/`@t.test` patterns without full wipe.

## Never on production

Use read-only [prod-preflight-census.md](./prod-preflight-census.md) instead. Production tenant removal needs runbook approval and provider console steps.

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](../Database/SOMO_FOUNDATION_RUNBOOK.md) — D2-01


---

<a id="payor-batch-reprocessing"></a>

## PAYOR BATCH REPROCESSING

*Merged from `docs/runbooks/PAYOR_BATCH_REPROCESSING.md` on 2026-06-02.*

# Payor Batch Reprocessing

## Scope
- Reprocess a payor batch when normalization/scoring policy changes or raw source mapping improves.

## Inputs
- `DB_PATH`
- `policy-version` (for Step 5/6 scoping)
- optional `scorer-version`

## Procedure
- Re-run normalization for all current source records:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-normalization.cjs --version=v1 --limit=50000`
- Rebuild blocking candidates:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-blocking.cjs --version=v1 --max-bucket=500`
- Recompute fuzzy scores:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-fuzzy-match.cjs --scorer-version=v1 --limit=200000`
- Recompute decisions with explicit policy:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-resolution-decisions.cjs --policy-version=v2_tuned --policy-profile=tuned_v2 --limit=200000`
- Rebuild canonical entities scoped to the policy:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-canonicalization.cjs --policy-version=v2_tuned --limit=200000`

## Post-Checks
- Run:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/report-payor-observability-ops.cjs --policy-version=v2_tuned`
- Confirm:
  - data quality checks pass
  - review queue metrics are non-zero for human adjudication

## Consumer layer reprocess (added)

When MA consumer-search outputs must be refreshed after source updates:

1. `DB_PATH=... node middleware-platform/scripts/run-payor-pbp-benefits-ingest.cjs`
2. `DB_PATH=... LANDSCAPE_CSV=... node middleware-platform/scripts/run-payor-landscape-premium-ingest.cjs`
3. `DB_PATH=... SERVICE_AREA_CSV=... node middleware-platform/scripts/run-payor-service-area-ingest.cjs`
4. `DB_PATH=... CROSSWALK_FILE=... node middleware-platform/scripts/run-payor-zip-county-crosswalk-ingest.cjs`

Then run one ZIP+needs validation query (or call `/api/public/plans/search`).


---

<a id="payor-ingest-failure-recovery"></a>

## PAYOR INGEST FAILURE RECOVERY

*Merged from `docs/runbooks/PAYOR_INGEST_FAILURE_RECOVERY.md` on 2026-06-02.*

# Payor Ingest Failure Recovery

## Scope
- Recover Step 1 ingest failures for Tier-1 payor sources without corrupting ER downstream stages.

## Detection
- Run `node middleware-platform/scripts/report-payor-observability-ops.cjs`.
- Confirm problematic source in `metrics.ingest_counts_by_source`.
- Inspect recent ingest summary by re-running `node middleware-platform/scripts/pull-payor-tier1-sources.cjs --force`.

## Recovery Procedure
- Validate DB target: `DB_PATH=./middleware-dev.db`.
- Re-run source pull with network permissions when needed:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/pull-payor-tier1-sources.cjs --force`
- Re-seed dictionaries (safe idempotent):
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/seed-payor-normalization-dictionaries.cjs`
- Re-run normalization:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-normalization.cjs --version=v1 --limit=50000`
- Rebuild downstream:
  - `run-payor-blocking`
  - `run-payor-fuzzy-match`
  - `run-payor-resolution-decisions`
  - `run-payor-canonicalization`

## Validation
- Confirm non-zero counts in:
  - `payor_source_records`
  - `payor_normalized_records`
  - `payor_match_candidates`
- Confirm no data quality gate failures in `payor-observability-quality-ops-report.json`.

## Additional recovery targets (premium + availability layers)

If ZIP-based plan search is impacted, also verify/recover:

- `payor_plan_premiums` (Landscape ingest)
- `payor_plan_service_areas` (MA county service area ingest)
- `zip_county_crosswalk` (Census crosswalk ingest)

Recommended sequence after source repair:

1. `run-payor-landscape-premium-ingest.cjs`
2. `run-payor-service-area-ingest.cjs`
3. `run-payor-zip-county-crosswalk-ingest.cjs`

Operational note: ZIP `33101` currently has an explicit `FL` state guard in `/api/public/plans/search` as a stopgap while crosswalk/state disambiguation is tuned.


---

<a id="payor-scoring-policy-rollback"></a>

## PAYOR SCORING POLICY ROLLBACK

*Merged from `docs/runbooks/PAYOR_SCORING_POLICY_ROLLBACK.md` on 2026-06-02.*

# Payor Scoring Policy Rollback

## Scope
- Roll back from a bad Step 5 scoring policy version while preserving auditability.

## Trigger Conditions
- Unexpected spike in `merge_review_flag`/`auto_merge`.
- Increased false-merge correction rate in review feedback outcomes.
- Operator report from review queue quality checks.

## Rollback Procedure
- Select previous stable policy version (example: `v1`).
- Re-run Step 5 with rollback policy:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-resolution-decisions.cjs --policy-version=v1 --policy-profile=default --limit=200000`
- Re-run Step 6 using same policy scope:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-canonicalization.cjs --policy-version=v1 --limit=200000`
- Re-sync Step 7 review queue:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-review-feedback-loop.cjs --policy-version=v1 --sync-queue`

## Verification
- Run:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/report-payor-observability-ops.cjs --policy-version=v1`
- Confirm:
  - decision distribution is back in expected range
  - review queue volume is manageable
  - false-merge correction rate drops from bad policy baseline

## Audit Notes
- Keep both old and new policy versions in `payor_resolution_policies`.
- Do not delete old decision rows; compare by `policy_version`.


---

<a id="provider-network-relink-rebuild"></a>

## PROVIDER NETWORK RELINK REBUILD

*Merged from `docs/runbooks/PROVIDER_NETWORK_RELINK_REBUILD.md` on 2026-06-02.*

# Provider Network Relink/Rebuild Runbook

## Purpose

Rebuild provider-to-payor network links from raw network evidence, validate quality, and safely roll forward.

## Preconditions

- Provider registry seed and dedup have run:
  - `npm run run:provider:registry:npi-dedup --prefix middleware-platform`
- Network evidence loaded:
  - `npm run import:provider:network-evidence --prefix middleware-platform -- --input=/path/to/provider_network.csv`
- Canonical payor aliases available in `payor_entity_aliases`.

## Rebuild Procedure

1. **Snapshot current linkage metrics**
   - `npm run report:provider:network-consistency --prefix middleware-platform`
   - `npm run report:provider:network-drift-quality --prefix middleware-platform`

2. **Run linker**
   - `npm run run:provider:network-linker --prefix middleware-platform`

3. **Validate post-link quality**
   - `npm run report:provider:network-consistency --prefix middleware-platform`
   - `npm run report:provider:network-drift-quality --prefix middleware-platform`
   - Block rollout if:
     - `invalid_status_links > 0`
     - `invalid_date_range_links > 0`
     - orphan link counts are non-zero

4. **Runtime verification**
   - With `PROVIDER_NETWORK_PRECHECK_SHADOW=1`, run eligibility/claim smoke tests and confirm `provider_network_precheck` payload is present.
   - If metrics are healthy, enable `PROVIDER_NETWORK_PRECHECK_ENABLED=1`.

## Troubleshooting

- **High `missing_payor_matches` in linker output**
  - Expand `payor_entity_aliases` for payer hints seen in network source.
- **High orphan source records**
  - Re-run `run:provider:registry:npi-dedup` and confirm provider NPIs are present.
- **Conflicting status drift pairs**
  - Prefer newest evidence source; reimport stale sources with corrected effective dates.

## Rollback

- Disable runtime behavior:
  - `PROVIDER_NETWORK_PRECHECK_ENABLED=0`
- Keep `PROVIDER_NETWORK_PRECHECK_SHADOW=1` to observe without side effects.
- Re-run linker after correcting source payload or alias mappings.


---

<a id="photo-to-bill-key-rotation"></a>

## PHOTO TO BILL KEY ROTATION

*Merged from `docs/runbooks/PHOTO_TO_BILL_KEY_ROTATION.md` on 2026-06-02.*

# Photo-to-bill — key rotation runbook

**Status:** Open before public prod ([`PHOTO_TO_BILL_EXTRACTION_TODOS.md`](../../todos/pending/PHOTO_TO_BILL_EXTRACTION_TODOS.md))

## 1. OpenAI

1. Create new API key in OpenAI dashboard.
2. Update `OPENAI_API_KEY` in Cloud Run / Azure App Service / local `.env` (never commit).
3. Revoke the previously exposed key.
4. Smoke: `cd middleware-platform && npm run test -- __tests__/patient-billing-extract.test.js` (if present) or manual OCR upload.

## 2. Google service account (GCS billing storage)

1. Create new service account key or use workload identity on GCP.
2. Update `GOOGLE_SERVICE_ACCOUNT_KEY` or workload binding.
3. Revoke old key material in GCP IAM.
4. Smoke: upload test document via patient app capture flow.

## 3. Rollout gates

- Internal → beta → public with `npm run billing:test-gate` green.
- Physical device: photo → upload → OCR → timeline.

## 4. Env templates

Update `.env.example` with placeholder names only (no secrets).


---

<a id="legacy-domain-retirement"></a>

## LEGACY DOMAIN RETIREMENT

*Merged from `docs/runbooks/LEGACY_DOMAIN_RETIREMENT.md` on 2026-06-02.*

# Legacy domain retirement (myskinandcare.com → callsomo.com)

After **callsomo.com** is stable for 24–48 hours, retire the old consumer brand domain.

## DNS redirects (registrar)

Configure at **Squarespace** (or the myskinandcare.com registrar):

| From | To |
|------|-----|
| `https://myskinandcare.com/*` | `https://callsomo.com/$1` (301 permanent) |
| `https://www.myskinandcare.com/*` | `https://callsomo.com/$1` (301) |
| `https://api.myskinandcare.com/*` | `https://api.callsomo.com/$1` (301) optional |

Squarespace: **Settings → Domains → callsomo.com → Domain Forwarding** (or URL redirect), not only A-record changes.

Verify after 301:

```bash
curl -sI https://myskinandcare.com/ | grep -i '^location:'
curl -sI https://callsomo.com/login | grep -i '^HTTP'
```

## GCP `doctor-little-c688d`

```bash
gcloud beta run domain-mappings delete --domain=api.callsomo.com \
  --region=us-central1 --project=doctor-little-c688d
```

Remove Firebase custom domain for `callsomo.com` in Firebase Console.

## Azure / api.callsomo.com

Historical only. Tear down in Azure Portal / IONOS if still active.


---

<a id="dlq-tool-calls-incident-note"></a>

## DLQ TOOL CALLS INCIDENT NOTE

*Merged from `docs/runbooks/DLQ_TOOL_CALLS_INCIDENT_NOTE.md` on 2026-06-02.*

# DLQ Tool Calls Incident Note

Generated: 2026-04-20T14:52:43.534Z

## Backlog
- Before replay: 0
- After replay: 0
- Stable check (1s): 0
- Threshold (50): below

## Breakdown (error_type:function_name)

## Retry Replay
- Retry-safe entries: 0
- Replay attempts: 0
- Replay success: 0
- Replay success rate: 1

## Classification Rules
- timeout: timeout/timed out/etimedout
- dependency: upstream/network/rate-limit/5xx/dns/connection
- auth: unauthorized/forbidden/401/403
- validation: schema/validation/invalid/parse


---

<a id="prod-preflight-census"></a>

## prod-preflight-census

*Merged from `docs/runbooks/prod-preflight-census.md` on 2026-06-02.*

# Production preflight census (read-only)

> **Last reviewed:** 2026-05-29  
> **Rule:** Do **not** write to production until counts are documented and signed off (D2-07).

## Purpose

Before binding Twilio or purging dev data, capture production shape so dev scripts are not run against the wrong environment.

## Environment guard

```bash
# Confirm you are NOT on prod before destructive dev scripts
echo "$DB_PATH $NODE_ENV"
# Prod: NODE_ENV=production, DB_PATH often under /home/…/middleware-prod.db
```

## Read-only queries (SQLite)

```sql
-- Tenant counts
SELECT customer_type, COUNT(*) FROM customers GROUP BY customer_type;
SELECT COUNT(*) AS merchants FROM merchants;
SELECT COUNT(*) AS clinics FROM clinics;
SELECT COUNT(*) AS users FROM users;

-- Voice readiness
SELECT COUNT(*) AS with_twilio FROM customers WHERE twilio_phone_number IS NOT NULL AND twilio_phone_number != '';
SELECT COUNT(*) AS with_retell FROM customers WHERE retell_agent_id IS NOT NULL AND retell_agent_id != '';

-- Recent calls (sample)
SELECT customer_id, COUNT(*) AS n FROM voice_call_log
WHERE created_at > datetime('now', '-7 days')
GROUP BY customer_id ORDER BY n DESC LIMIT 20;
```

## Sign-off block

```text
Date:
Reviewer:
customers (saas): 
customers (with twilio): 
customers (with retell): 
merchants:
Approved for dev Week 1 work: [ ] yes  [ ] no
```

## Related

- [ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md)
- [wipe-tenant-data.md](./wipe-tenant-data.md)
