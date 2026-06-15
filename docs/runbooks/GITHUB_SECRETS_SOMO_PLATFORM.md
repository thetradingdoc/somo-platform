# GitHub secrets — somo-platform

Configure on the **somo** GitHub repository (Settings → Secrets and variables → Actions).

## Required for `deploy-callsomo.yml`

| Secret | Purpose |
|--------|---------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Federation provider for GCP deploy |
| `GCP_SERVICE_ACCOUNT` | Deploy service account email (`@somo-callsomo.iam.gserviceaccount.com`) |
| `FIREBASE_TOKEN` | Firebase CLI token for `firebase deploy --only hosting` to `somo-4ddf6` |

Optional but recommended:

| Secret | Purpose |
|--------|---------|
| `RETELL_API_KEY` | Post-deploy `configure-retell.js` (production WSS URL) |
| `RETELL_AGENT_ID` | Target agent when multiple agents exist |

Repository **variables** (Settings → Variables):

| Variable | Purpose |
|----------|---------|
| `CLOUDSQL_CONNECTION_NAME` | Cloud SQL socket for production deploy |

## Required for CI

| Secret / check | Purpose |
|----------------|---------|
| `npm run check:legacy-hosts` | Fails on new `myskinandcare` / `doclittle.site` in active code |
| `npm run check:brand-strings` | Somo UI brand consistency |

Optional:

| Secret | Purpose |
|--------|---------|
| `STAGING_API_BASE` | Optional staging smoke URL in manual CI runs |

## Staging / production runtime (Cloud Run Secret Manager)

Provision via `scripts/provision-staging-secrets.sh` and document in team vault:

- `ANTHROPIC_API_KEY`, `RETELL_API_KEY`, `STRIPE_*`, `TWILIO_*`
- `DB_PATH` or Cloud SQL connection
- `KELLY_RAILS_V2`, `KELLY_ALLOW_HYBRID_GRAPH`

Cloud Run reads `somo-staging-*` secrets when `USE_GCP_SECRETS=1` (see `generate-cloudrun-env-yaml.cjs`).

## Verification

```bash
gh secret list -R richiejeremiah/somo
gh workflow run deploy-callsomo.yml -R richiejeremiah/somo
```

## Railway / legacy

Confirm the legacy Railway project is **not** linked to duplicate deploy triggers. See [DOCLITTLE_ARCHIVE.md](./DOCLITTLE_ARCHIVE.md).

**Note:** `FIREBASE_SERVICE_ACCOUNT` (JSON) is an alternative to `FIREBASE_TOKEN`; the deploy workflow uses `FIREBASE_TOKEN`.
