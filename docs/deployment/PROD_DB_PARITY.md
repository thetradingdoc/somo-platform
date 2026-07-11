# Production database parity

**Last updated:** 2026-07-10  
**Audience:** Engineering and operators  
**GCS object:** `gs://somo-staging-db-somo-callsomo/middleware-staging.db`  
**Cloud Run mount:** `/var/data/middleware-staging.db`

This file is the SSOT for **prod/staging SQLite row counts and file size**. Medical coding import commands live in [Medical Coding OPERATIONS](../Medical%20Coding/OPERATIONS.md).

---

## Snapshot (verified 2026-07-10)

| Table / metric | Count | Notes |
|----------------|------:|-------|
| `icd10_codes` | 74,260 | FY2025 ICD-10-CM |
| `cpt_codes` | 16,851 | MPFS (not DHS ~1,299) |
| `hcpcs_codes` | 9,006 | Level II |
| `fee_schedules` | 30,586 | Medicare MPFS |
| `code_embeddings` | 110,017 | ICD+CPT+HCPCS specialty backfill + ~9,900 CDT |
| File size | ~3.1 GB | Embedding JSON in SQLite drives size |

**Gate:** `PINECONE_DEPLOY_GATE=1 DB_PATH=./var/db/middleware-prod.db npm run verify:prod-codebook`

---

## Why prod uses 8 Gi Cloud Run memory

The prod DB (~3.1 GB on disk) loads into process memory on cold start. Deploy scripts default to **2 Gi** (`scripts/deploy-to-gcp.sh`); **live prod** runs **8 Gi / 4 CPU** to avoid OOM during startup and Retell WebSocket sessions.

When resizing after a codebook upload:

```bash
gcloud run services update somo-middleware \
  --region=us-central1 \
  --memory=8Gi \
  --cpu=4
```

Long-term: slim SQLite (tenant/quote data only) and Pinecone-only semantic search — see [PLATFORM_SNAPSHOT.md](../architecture/PLATFORM_SNAPSHOT.md) §5.

---

## Operator workflow

### Pull prod snapshot locally

```bash
# repo root
npm run phase1:pull-db
# or
cd middleware-platform
GCS_DB_BUCKET=somo-staging-db-somo-callsomo node scripts/cloudrun-db-sync.cjs download
```

### Upload after verified changes

```bash
GCS_DB_BUCKET=somo-staging-db-somo-callsomo GCS_DB_UPLOAD_FORCE=1 \
  DB_PATH=./var/db/middleware-prod.db \
  node scripts/cloudrun-db-sync.cjs upload
```

Pre-upload backup:

```bash
gsutil cp gs://somo-staging-db-somo-callsomo/middleware-staging.db \
  gs://somo-staging-db-somo-callsomo/backups/middleware-pre-codebook-$(date +%Y%m%d-%H%M%S).db
```

Restart Cloud Run after upload so instances pull the new object (or wait for natural recycle).

### Operator DID binding (+363)

Platform company line must bind to `cust_b7c7d3e1-31e6-4fbb-b6fd-8e306a79fad8` (operator), not navigation demo:

```bash
DB_PATH=./var/db/middleware-prod.db node scripts/seed-operator-customer.cjs
DB_PATH=./var/db/middleware-prod.db node scripts/bind-operator-platform-did.cjs
```

See [PLATFORM_SALES_363_DEPLOY.md](./PLATFORM_SALES_363_DEPLOY.md).

---

## Dev vs prod

| Environment | Typical `DB_PATH` | Codebook |
|-------------|-------------------|----------|
| Local dev | `middleware-platform/var/db/middleware-dev.db` | Full imports in dev |
| CI fixture | `middleware-platform/var/db/middleware-ci-coding.db` | Slim fixture for gates |
| Prod GCS | `middleware-staging.db` | Row counts above |

Postgres (`POSTGRES_URL`) is an **optional mirror**, not primary SSOT. See [Database ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md).

---

## Related

- [Medical Coding OPERATIONS](../Medical%20Coding/OPERATIONS.md) — import, embeddings, eval
- [CODING-FOUNDATION.md](../../todos/CODING-FOUNDATION.md) — epic closeout evidence
- [PLATFORM_SNAPSHOT.md](../architecture/PLATFORM_SNAPSHOT.md) — full platform architecture
