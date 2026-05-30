# GitHub migration: doclittle-platform → somo-platform

**Status:** Repository cutover complete (2026-05-29).

| Item | Value |
|------|--------|
| New remote | `https://github.com/richiejeremiah/somo-platform` (private) |
| Legacy remote | `doclittle-old` → `richiejeremiah/doclittle-platform` (archive after smoke) |
| Production hosts | `myskinandcare.com` / `api.myskinandcare.com` (unchanged until somopay.ai) |

## Manual follow-up

1. **GitHub Actions secrets** — configure on `richiejeremiah/somo-platform`:

| Secret / variable | Purpose |
|-------------------|---------|
| `FIREBASE_TOKEN` | `firebase deploy` for `myskinandcare.com` hosting |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF for deploy-staging workflow |
| `GCP_SERVICE_ACCOUNT` | SA email with Cloud Run + Secret Manager access |
| `CLOUDSQL_CONNECTION_NAME` (repo **variable**) | e.g. `doctor-little-c688d:us-central1:somo-staging-pg` |

**GCP Secret Manager** (`somo-staging-*` prefix): seed via `./scripts/provision-staging-secrets.sh` from operator `.env`. Keys: `JWT_SECRET`, `TWILIO_*`, `RETELL_*`, `STRIPE_*`, `SOMO_OWNER_PASSWORD`, `POSTGRES_URL`. See `middleware-platform/.env.staging.example`.

2. **GCP / Firebase access (Phase 0 checklist)**

| Check | Command / URL |
|-------|----------------|
| GCP project | `gcloud config get-value project` → `doctor-little-c688d` |
| API live | `curl -sS https://api.myskinandcare.com/health/live` |
| UI live | `curl -sS -I https://myskinandcare.com` |
| Bootstrap script | `npm run gcp:bootstrap:check` |

3. **Railway** — **deprecated** for API. Production/staging API SSOT is Cloud Run `myskin-middleware`. Disconnect Railway GitHub auto-deploy if still linked.

4. **Deploy API** — `./scripts/deploy-to-gcp.sh` or `.github/workflows/deploy-staging.yml` (manual dispatch).

5. **Firebase Hosting** — `npm run deploy:staging-hosting` (full `hosting-dist` bundle).

6. **Archive old repo** — After green CI on `somo-platform` `main`, archive `doclittle-platform`.

## Clone

```bash
git clone https://github.com/richiejeremiah/somo-platform.git somo
cd somo
```
