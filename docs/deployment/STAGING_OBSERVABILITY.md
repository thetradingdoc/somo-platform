# Staging observability and ops

## Logging alerts (GCP)

Configure in Cloud Monitoring for service `myskin-middleware` (`us-central1`):

| Alert | Condition |
|-------|-----------|
| Error rate | 5xx > 5% over 5 min |
| Startup failures | Cloud Run revision failed / probe failures |
| Latency | p95 > 10s on `/voice/*` |

## Uptime checks

| URL | Expected |
|-----|----------|
| `https://api.myskinandcare.com/health/live` | 200 |
| `https://myskinandcare.com/` | 200 |
| `https://myskinandcare.com/signup` | 200 HTML |

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

**Deprecated for staging/production.** CI no longer deploys to Railway. API SSOT: Cloud Run `myskin-middleware`.

## Related

- [GCP_DEPLOY_ROLLBACK_RUNBOOK.md](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)
- [STAGING_SIGNOFF.md](./STAGING_SIGNOFF.md)
