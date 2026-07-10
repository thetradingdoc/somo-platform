# Codebook refresh calendar

> **Last updated:** 2026-07-10  
> **Tasks:** CODING-FOUNDATION N-11, B-10  
> **Owner:** Ops (primary) + Engineering (import scripts)  
> **Status:** Active calendar — assign named owners before first production refresh

Annual and ad-hoc refresh schedule for ICD-10-CM, CPT/MPFS, HCPCS, and CDT codebooks used by the voice coding spine.

---

## Annual calendar (US)

| Window | Code set | Effective date | Source | Import command | Owner |
|--------|----------|----------------|--------|----------------|-------|
| **Sep–Oct** | ICD-10-CM (FY) | **Oct 1** each FY | CDC/NCHS zip → `Knowledge/ICD-10 Files/FY20xx/` | `node scripts/import-icd10-codes.js` | Ops |
| **Oct–Nov** | CPT / **MPFS** RVU | **Jan 1** (file published ~Dec prior; Oct RVU for Q4) | CMS [PFS RVU files](https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files) → `Knowledge/fee-schedules/` | `import-cpt-codes.js --source mpfs` + `import-mpfs-medicare.js` | Ops |
| **Nov–Dec** | Medicare **fee_schedules** | Jan 1 | Same RVU file as CPT | `node scripts/import-mpfs-medicare.js` | Ops |
| **Dec–Jan** | HCPCS Level II | **Jan 1** | CMS annual → `Knowledge/HCPCS/hcpc20xx_jan_*/` | `node scripts/import-hcpcs-codes.js` | Ops |
| **Jan–Feb** | **CDT** (dental) | **Jan 1** (ADA annual) | ADA CDT release → `Knowledge/CDT/` | `node scripts/import-cdt-codes.js` | Eng (pending ADA license N-01) |

**Note:** MPFS October and January files may both land in a calendar year. Import the **latest CMS file** before Jan 1 effective claims; re-run `verify:prod-codebook` after each import.

---

## FY2026 execution checklist (example)

Use as template each cycle; copy to ops ticket.

### Pre-import (all code sets)

- [ ] Legal: CPT/CDT licenses current — [CODEBOOK_LICENSING.md](../compliance/CODEBOOK_LICENSING.md)
- [ ] GCS DB backup:

```bash
gsutil cp gs://somo-staging-db-somo-callsomo/middleware-staging.db \
  gs://somo-staging-db-somo-callsomo/backups/middleware-pre-codebook-$(date +%Y%m%d-%H%M%S).db
```

- [ ] Dev import + eval green on branch
- [ ] `npm run verify:prod-codebook` baseline recorded

### ICD-10-CM (October)

```bash
cd middleware-platform
export SKIP_STARTUP_MIGRATIONS=1
# Update Knowledge/ICD-10 Files to new FY zip
node scripts/import-icd10-codes.js
node scripts/populate-code-embeddings.js --type icd10 --incremental --until-done
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding
npm run verify:prod-codebook
```

**Gate:** ICD rows ≥ 70k; eval accuracy ≥ 60% (target 92% dev parity).

### MPFS CPT + fee schedules (October–January)

```bash
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/populate-code-embeddings.js --type cpt --incremental --until-done --batch-size 5000
npm run audit:eval-cpt
npm run verify:prod-codebook
```

**Gate:** `cpt_codes` ≥ 15,000; CPT embedding count matches `cpt_codes`.

### HCPCS (January)

```bash
# Point import script at new Knowledge/HCPCS/... path
node scripts/import-hcpcs-codes.js
node scripts/populate-code-embeddings.js --type hcpcs --incremental --until-done
npm run verify:prod-codebook
```

**Gate:** HCPCS ≥ 8,000 rows.

### CDT (January, dental)

```bash
node scripts/import-cdt-codes.js
node scripts/populate-code-embeddings.js --type cdt --incremental --until-done
```

**Gate:** ≥ 800 CDT rows, ≥ 80% non-placeholder descriptions (B-06).

### Post-import (production)

- [ ] Upload refreshed SQLite to GCS **or** run Option B imports on prod host — [PROD_DB_PARITY](../deployment/OPERATIONS.md#prod-db-parity)
- [ ] Re-index Pinecone code-metadata if chunk corpus changes (eng runbook §5.3)
- [ ] Confirm `OPENAI_EMBEDDING_MODEL` unchanged or re-embed full set if model changes — [ARCHITECTURE.md](./ARCHITECTURE.md#embedding-model-version)
- [ ] `capture:coding-prod-evidence` after deploy
- [ ] Update "Last reviewed" date in this doc

---

## Embeddings long-run

Full re-embed after large codebook delta:

```bash
npm run embeddings:daemon
npm run embeddings:daemon:status
```

Log: `middleware-platform/tmp/embeddings-daemon.log`

---

## Pinecone re-index

When code-metadata chunks change (not automatic on SQLite import):

1. Confirm `PINECONE_INDEX_HOST` and vector count in `production-readiness-gate.cjs`.
2. Run vector sync per ARCHITECTURE §5.3 provenance procedure (D-03).
3. Tune `PINECONE_MIN_SCORE` / `PINECONE_FALLBACK_MIN_SCORE` if recall shifts.

Dental tenants: **no Pinecone** — CDT refresh is SQLite + embeddings only.

---

## Rollback

If post-import eval or prod smoke fails:

1. Stop writes to prod DB.
2. Restore latest pre-import GCS object from `backups/`.
3. Follow [ARCHITECTURE.md § Codebook rollback](./ARCHITECTURE.md#codebook-rollback).

---

## Related documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — data layer
- [OPERATIONS.md](./OPERATIONS.md) — day-to-day commands
- [deployment OPERATIONS.md](../deployment/OPERATIONS.md#medical-codebook-setup) — CMS file paths
- [CODEBOOK_LICENSING.md](../compliance/CODEBOOK_LICENSING.md)
- [CODING-FOUNDATION.md](../../todos/CODING-FOUNDATION.md) — B-01..B-10 tasks
