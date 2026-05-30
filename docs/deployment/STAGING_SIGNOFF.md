# Staging sign-off checklist (myskinandcare.com)

Complete after `./scripts/deploy-staging-all.sh` or `.github/workflows/deploy-staging.yml`.

## Automated gates

```bash
npm run gcp:bootstrap:check
npm run smoke:staging
STAGING=1 npm run gate:week1 --prefix middleware-platform
npm run test:e2e:staging --prefix middleware-platform   # optional
```

## Manual checklist

- [ ] https://myskinandcare.com/ — landing loads, demo CTA visible
- [ ] https://myskinandcare.com/signup?fresh=1 — SIM trial signup completes
- [ ] https://myskinandcare.com/login — owner login (`SOMO_OWNER_EMAIL`)
- [ ] https://myskinandcare.com/business/agent.html — greeting save + Retell sync
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

`https://api.myskinandcare.com/voice/incoming?customer_id=<OWNER_CUSTOMER_ID>`

## Rollback drill

```bash
./scripts/rollback-gcp-release.sh
# Firebase: redeploy previous hosting-dist from git tag or local backup
```

## Related

- [STAGING_MYSKINANDCARE.md](./STAGING_MYSKINANDCARE.md)
- [STAGING_CLOUDSQL.md](./STAGING_CLOUDSQL.md)
- [GCP_DEPLOY_ROLLBACK_RUNBOOK.md](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)
