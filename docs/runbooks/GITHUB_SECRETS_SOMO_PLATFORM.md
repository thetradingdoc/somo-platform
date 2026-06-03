# GitHub secrets — somo-platform

Configure on the **somo-platform** GitHub repository (Settings → Secrets and variables → Actions).

## Required for CI/CD

| Secret | Purpose |
|--------|---------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF for GCP deploy |
| `GCP_SERVICE_ACCOUNT` | Deploy service account email |
| `FIREBASE_SERVICE_ACCOUNT` | Hosting deploy (JSON) |
| `STAGING_API_BASE` | Optional staging smoke URL |

## Staging / production runtime (Cloud Run)

Provision via `scripts/provision-staging-secrets.sh` and document in team vault:

- `ANTHROPIC_API_KEY`, `RETELL_API_KEY`, `STRIPE_*`, `TWILIO_*`
- `DB_PATH` or Cloud SQL connection
- `KELLY_RAILS_V2`, `KELLY_ALLOW_HYBRID_GRAPH`

## Verification

```bash
gh secret list -R <org>/somo-platform
```

## Railway

Confirm the legacy Railway project is **not** linked to `doclittle-platform` or duplicate deploy triggers. See [DOCLITTLE_ARCHIVE.md](./DOCLITTLE_ARCHIVE.md).
