# Production database parity (embeddings, MPFS, NPPES taxonomy)

Dev SQLite (`middleware-dev.db`) is the reference. Replicate these counts on production before relying on semantic search, voice coding, or fee/taxonomy features.

| Table / asset | Dev target count | How to build |
|---------------|------------------|--------------|
| `icd10_codes` | ~74,260 | `node scripts/import-icd10-codes.js` |
| `cpt_codes` | **~17,170** (Medicare PFS) | `node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv` |
| `hcpcs_codes` | ~9,006 | `node scripts/import-hcpcs-codes.js` |
| `code_embeddings` | ~100,000+ | `populate-code-embeddings.js --until-done` (CPT incremental after MPFS import) |
| `fee_schedules` (MPFS) | ~15,272 | `node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv` |
| `provider_taxonomy_links` | ~1.76M | `npm run payor:npi-dedup-directory` after `nppes_directory_providers` load |

**Do not use DHS-only CPT import on production** (~1,299 rows, missing 99202–99215 E/M).

## Option A — Copy dev DB to prod host

```bash
# On dev machine (stop writers first)
cd middleware-platform
sqlite3 middleware-dev.db ".backup 'middleware-prod-seed.db'"

# Upload to Render persistent disk / prod server, set SQLITE_PATH or DATABASE_URL
```

## Option B — Re-run imports on prod

From `middleware-platform/` on the production host (with CMS files under `Knowledge/`):

```bash
export SKIP_STARTUP_MIGRATIONS=1
node scripts/import-icd10-codes.js
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/import-hcpcs-codes.js
node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/populate-code-embeddings.js --type cpt --incremental --until-done --batch-size 5000
node scripts/populate-code-embeddings.js --until-done --batch-size 5000
npm run payor:npi-dedup-directory
```

## Verify

```bash
npm run verify:prod-codebook
# or manually:
sqlite3 "$DATABASE_PATH" "
  SELECT 'cpt_codes', COUNT(*) FROM cpt_codes
  UNION ALL SELECT 'cpt_emb', COUNT(*) FROM code_embeddings WHERE code_type='cpt'
  UNION ALL SELECT 'embeddings', COUNT(*) FROM code_embeddings WHERE embedding_json IS NOT NULL
  UNION ALL SELECT 'mpfs', COUNT(*) FROM fee_schedules;
"
```

Expected: `cpt_codes` ≥ 15,000; `cpt_emb` should match `cpt_codes` count.

## Render env (coding)

| Variable | Production value |
|----------|------------------|
| `SEMANTIC_SEARCH_ENABLED` | `true` |
| `RAG_API_URL` | `disabled` (use live Pinecone via `PINECONE_*`; do not default to localhost) |
| `REMOTE_RAG_TIMEOUT_MS` | `2000` (voice dual-source remote leg) |
| `PINECONE_API_KEY` / `PINECONE_INDEX_HOST` | Set per [MEDICAL_CODEBOOK_SETUP.md](./MEDICAL_CODEBOOK_SETUP.md) |

See [RENDER_PRODUCTION_CHECKLIST.md](./RENDER_PRODUCTION_CHECKLIST.md).
