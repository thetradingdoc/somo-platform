# Medical coding — operations

> **Last reviewed:** 2026-05-25  
> Thin runbook. Full import and CMS file paths live in [MEDICAL_CODEBOOK_SETUP.md](../deployment/MEDICAL_CODEBOOK_SETUP.md).

## Production checklist (before trusting live coding)

1. **Prod DB** — MPFS CPT (~17k rows) + CPT embeddings on production SQLite. See [PROD_DB_PARITY.md](../deployment/PROD_DB_PARITY.md).
2. **Verify counts** — on prod host: `npm run verify:prod-codebook`
3. **Render env** — [RENDER_PRODUCTION_CHECKLIST.md](../deployment/RENDER_PRODUCTION_CHECKLIST.md):
   - `SEMANTIC_SEARCH_ENABLED=true`
   - `RAG_API_URL=disabled` (use Pinecone via `PINECONE_*`; do not leave unset → old localhost default in some tools)
   - `REMOTE_RAG_TIMEOUT_MS=2000`
   - `STEDI_CLAIM_SUBMISSION_MODE=professional`
   - `STEDI_WEBHOOK_SECRET` + register `/webhooks/stedi/claim-status`
4. **Stedi webhook** — steps in MEDICAL_CODEBOOK_SETUP.md § Stedi claim-status webhook

## Dev codebook build (reference)

From `middleware-platform/` with CMS files under `Knowledge/`:

```bash
export SKIP_STARTUP_MIGRATIONS=1
node scripts/import-icd10-codes.js
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/import-hcpcs-codes.js
node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
node scripts/populate-code-embeddings.js --type cpt --incremental --until-done --batch-size 5000
node scripts/populate-code-embeddings.js --until-done --batch-size 5000
```

**Do not** use DHS-only CPT import (~1,299 rows) for production or eval — missing E/M codes 99202–99215.

## Verify and audit

| Command | Purpose |
|---------|---------|
| `npm run verify:prod-codebook` | CPT ≥ 15k, CPT embeddings parity |
| `npm run audit:eval-cpt` | Expected eval CPTs exist in `cpt_codes` |
| `npm run verify:stedi-env` | 837P mode + webhook secret present (local check) |

## Accuracy eval (regression)

Fast path (matches voice default: keyword + phrase + dual-source, semantic off):

```bash
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding
```

Optional semantic-on (slow; not fully baselined):

```bash
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled npm run eval:coding
# or EVAL_USE_SEMANTIC=true explicitly
```

Output: `middleware-platform/tmp/coding-accuracy-report.json`

## Embeddings daemon (long runs)

```bash
npm run embeddings:daemon
npm run embeddings:daemon:status
npm run embeddings:daemon:stop
```

Log: `middleware-platform/tmp/embeddings-daemon.log`

## Optional Flask RAG service

Only if you maintain a separate Colab/Render `medical-rag-api`: [Knowledge/RAG/FLASK_DEPLOY_CPT.md](../../Knowledge/RAG/FLASK_DEPLOY_CPT.md). Production default is **direct Pinecone** from middleware, not Flask.

## Fee schedules

```bash
npm run fee-schedule:mpfs
# or: node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
```

See [Knowledge/fee-schedules/README.md](../../Knowledge/fee-schedules/README.md).
