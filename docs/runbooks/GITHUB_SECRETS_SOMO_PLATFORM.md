# GitHub secrets — somo-platform

Configure on the **somo** GitHub repository (Settings → Secrets and variables → Actions).

## Local deploy (default — no GitHub Actions deploy)

Production deploy uses **local CLI** (no GitHub billing for deploy):

```bash
firebase login
gcloud auth login
npm run deploy:callsomo
```

No GitHub secrets required for deploy when using this path.

## Optional — only if re-enabling GitHub Actions deploy later

| Secret | Purpose |
|--------|---------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Federation for GCP deploy |
| `GCP_SERVICE_ACCOUNT` | Deploy service account email |
| `FIREBASE_TOKEN` | Firebase CLI token for non-interactive `firebase deploy` |
| `RETELL_API_KEY` | Post-deploy `configure-retell.js` |
| `RETELL_AGENT_ID` | Target agent when multiple agents exist |

## CI (tests only)

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs tests on push/PR. It does **not** deploy.

Optional manual CI input:

| Secret / variable | Purpose |
|-------------------|---------|
| `STAGING_API_BASE` | Optional staging API URL for route evidence |

## Cloud Run runtime (Secret Manager)

Provision via `scripts/provision-staging-secrets.sh` from operator `.env`:

- `ANTHROPIC_API_KEY`, `RETELL_API_KEY`, `STRIPE_*`, `TWILIO_*`
- `DB_PATH` or Cloud SQL connection
- `KELLY_RAILS_V2`, `KELLY_ALLOW_HYBRID_GRAPH`

Cloud Run reads `somo-staging-*` secrets when `USE_GCP_SECRETS=1`.

## Verification

```bash
gh secret list -R richiejeremiah/somo   # optional; not needed for local deploy
npm run smoke:callsomo
```

## Railway / legacy

Confirm the legacy Railway project is **not** linked to duplicate deploy triggers. See [DOCLITTLE_ARCHIVE.md](./DOCLITTLE_ARCHIVE.md).
