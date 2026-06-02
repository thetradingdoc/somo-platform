# callsomo.com GCP cutover (project `somo-callsomo`)

**Status (2026-06-01):** Cloud Run `myskin-middleware` is deployed. Domain mapping for `api.callsomo.com` exists. Finish DNS, Firebase, org policy, and webhooks below.

| Project | ID | Role |
|---------|-----|------|
| GCP (API / Cloud Run / billing) | **`somo-callsomo`** | `myskin-middleware`, secrets, `api.callsomo.com` |
| Firebase (Hosting UI) | **`somo-4ddf6`** | `callsomo.com` static site — [.firebaserc](../../unified-dashboard/.firebaserc) |

ID `somo` alone is too short for GCP (min 6 characters).

| Role | URL |
|------|-----|
| UI | `https://callsomo.com` |
| API | `https://api.callsomo.com` |
| Cloud Run URL (direct) | `gcloud run services describe myskin-middleware --region=us-central1 --project=somo-callsomo --format='value(status.url)'` |

## 1. DNS for API

| Name | Type | Value |
|------|------|--------|
| `api` | CNAME | `ghs.googlehosted.com` |

```bash
gcloud beta run domain-mappings describe --domain=api.callsomo.com \
  --region=us-central1 --project=somo-callsomo
```

## 2. Firebase Hosting (UI)

Firebase is **not** linked yet (API returned 403). As `richard@callsomo.com`:

1. Open [Firebase Console](https://console.firebase.google.com/) → **Add project** → select existing GCP project **somo-callsomo**.
2. Enable Hosting (project **`somo-4ddf6`** in Firebase Console).
3. Deploy from repo (must use **`richard@callsomo.com`** for Firebase CLI, not `drlittlekids@gmail.com`):

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
gcloud run services update myskin-middleware --region=us-central1 --project=somo-callsomo --no-invoker-iam-check
```

[`scripts/deploy-to-gcp.sh`](../../scripts/deploy-to-gcp.sh) passes `--no-invoker-iam-check` on deploy so new revisions stay public.

**Alternative:** Org admin relaxes `constraints/iam.allowedPolicyMemberDomains` for project `somo-callsomo`, or HTTPS Load Balancing in front of Cloud Run.

Authenticated health check:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$(gcloud run services describe myskin-middleware --region=us-central1 --project=somo-callsomo --format='value(status.url)')/health/live"
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
export PW_API_BASE_URL="$(gcloud run services describe myskin-middleware --region=us-central1 --project=somo-callsomo --format='value(status.url)')"
export PLAYWRIGHT_API_BEARER="$(gcloud auth print-identity-token)"
npm run test:e2e:callsomo:smoke --prefix middleware-platform
```

## 8. Retire legacy

After 24–48h on callsomo.com:

1. 301 `myskinandcare.com` → `https://callsomo.com`
2. Remove domain mappings on `doctor-little-c688d`
3. Disable billing on old project if unused
