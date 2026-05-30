# Staging rollout — provider SIM trial

**Last updated:** 2026-05-29  
**Staging host:** [`STAGING_MYSKINANDCARE.md`](./STAGING_MYSKINANDCARE.md) — UI on `myskinandcare.com`, API on `api.myskinandcare.com`  
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
API_BASE_URL=https://api.myskinandcare.com
BASE_URL=https://api.myskinandcare.com
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
- [ ] Full signup: `https://myskinandcare.com/signup?fresh=1` (after `npm run deploy:staging-hosting`) → email → phone OTP → terms → trial activation
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

```bash
cd middleware-platform
TRIAL_SIM_FLOW_ENABLED=1 npm start
# separate terminal:
npx playwright test e2e/provider-trial-signup.spec.cjs
```

## Rollback

Set `TRIAL_SIM_FLOW_ENABLED=0` — signup skips phone step; existing trials still expire via cron.
