# Production Somo create — one-time runbook

**Run once.** After success, use `PW_MODE=reuse` only.

Automated path: `dentist-journey-parity.spec.cjs` with `PW_ENV=production PW_MODE=create` runs browser signup + voice-setup (no manual browser step). Manual signup below is **break-glass only**.

## Prerequisites

- [ ] Phase 1 cleanup uploaded to GCS
- [ ] Compliance sign-off (`docs/qa/portal-e2e-compliance.md`)
- [ ] Deploy SHA gate green
- [ ] Stripe test mode verified
- [ ] `TRIAL_E2E_PHONE` — dedicated test mobile you control
- [ ] OTP source: `STAGING_DB_PATH` pointed at prod GCS snapshot **with sync**, or `PORTAL_E2E_EMAIL_CODE` for the signup inbox

## Automated create (preferred)

```bash
cd middleware-platform

# .env
# TRIAL_E2E_PHONE=+1XXXXXXXXXX
# STAGING_DB_PATH=../backups/middleware-staging.db
# GCS_DB_BUCKET=somo-staging-db-somo-callsomo   # optional — polls fresh OTP during signup

PW_ENV=production PW_MODE=create PW_TIER=p0 npm run test:e2e:portal
```

Or via orchestrator (after phase1 upload):

```bash
node scripts/portal-e2e-run.cjs --step=prod-create
```

Checkpoints are written to `test-results/portal-e2e/somo-create-state.json` after signup and each voice-setup step.

Resume after failure:

```bash
PW_ENV=production PW_MODE=resume npm run test:e2e:portal
```

Break-glass rollback:

```bash
PW_FORCE_ROLLBACK=1 PW_ENV=production PW_MODE=create npm run test:e2e:portal
```

## Break-glass: manual browser signup

Only if Playwright create is blocked (OTP sync, Retell, etc.):

1. Open `https://callsomo.com/signup?fresh=1`
2. Complete wizard — practice name **Somo**
3. Finish voice-setup through **today** dashboard
4. Update `somo-create-state.json` → `complete` and store credentials in GitHub Secrets

## Post-create

### Re-bind Kelly DID

```bash
cd middleware-platform
PORTAL_E2E_SOMO_CUSTOMER_ID=cust_<from_portal> npm run portal-e2e:somo-bind
```

### Verify

```bash
DB_PATH=../backups/middleware-staging.db npm run portal-e2e:phase1-verify
MIDDLEWARE_API_BASE=https://api.callsomo.com PORTAL_E2E_SOMO_CUSTOMER_ID=cust_<id> npm run portal-e2e:did-verify
```

### Store credentials

- GitHub Secrets: `PW_SOMO_PROD_EMAIL`, `PW_SOMO_PROD_PASS` (if password login applies)
- `somo-create-state.json` → `complete`

### Prod reuse gate

```bash
PW_ENV=production PW_MODE=reuse PW_TIER=p0 npm run test:e2e:portal
```
