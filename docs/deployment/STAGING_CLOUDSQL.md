# Staging Cloud SQL (Postgres mirror)

> **Project:** `doctor-little-c688d` · **Region:** `us-central1` · **Instance:** `somo-staging-pg`

SQLite remains **primary** for reads/writes in `middleware-platform/database.js`. Cloud SQL Postgres is provisioned for mirror/write-through, backups, and the future Postgres-primary flip.

## Provision (operator)

```bash
export GCP_PROJECT=doctor-little-c688d
export REGION=us-central1
export INSTANCE=somo-staging-pg
export CONNECTION_NAME="${GCP_PROJECT}:${REGION}:${INSTANCE}"

# Create instance (Postgres 15, smallest tier for staging)
gcloud sql instances create "$INSTANCE" \
  --project="$GCP_PROJECT" \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-auto-increase \
  --backup

gcloud sql databases create somo_staging --instance="$INSTANCE" --project="$GCP_PROJECT"

# App user (replace PASSWORD before running)
gcloud sql users create somo_app \
  --instance="$INSTANCE" \
  --project="$GCP_PROJECT" \
  --password='CHANGE_ME'

# Store connection string in Secret Manager
echo -n "postgresql://somo_app:CHANGE_ME@/somo_staging?host=/cloudsql/${CONNECTION_NAME}" | \
  gcloud secrets create somo-staging-postgres-url --data-file=- --project="$GCP_PROJECT" \
  || gcloud secrets versions add somo-staging-postgres-url --data-file=- --project="$GCP_PROJECT"
```

## Cloud Run connector

Deploy with:

```bash
export CLOUDSQL_CONNECTION_NAME="${GCP_PROJECT}:${REGION}:${INSTANCE}"
./scripts/deploy-to-gcp.sh
```

`generate-cloudrun-env-yaml.cjs` reads `POSTGRES_URL` from Secret Manager when `USE_GCP_SECRETS=1`.

## Verify

```bash
# From a Cloud Run Job with the same connector:
psql "$POSTGRES_URL" -c 'SELECT 1'
```

## Related

- Durable SQLite: `middleware-platform/scripts/cloudrun-db-sync.cjs` + `GCS_DB_BUCKET=somo-staging-db`
- Env SSOT: `middleware-platform/.env.staging.example`
- Deploy: `scripts/deploy-to-gcp.sh`
