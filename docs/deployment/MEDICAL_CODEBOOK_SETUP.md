# Medical codebook setup (local dev)

## Pinecone API key rotation

If `PINECONE_API_KEY` was exposed in logs, chat, or shared docs:

1. [Pinecone console](https://app.pinecone.io/) → API keys → revoke the old key.
2. Create a new key and set it in `middleware-platform/.env` and Render env for `medical-rag-api` (Flask RAG).
3. Set `PINECONE_INDEX_HOST` for middleware direct-query fallback.
4. Never commit `.env`.

## CMS files (repo paths)

| Code set | Path |
|----------|------|
| ICD-10-CM FY2025 | `Knowledge/ICD-10 Files/FY2025 Code Descriptions/icd10cm-codes-2025.txt` (CDC zip) |
| **CPT (Medicare PFS — recommended)** | `Knowledge/fee-schedules/RVU26A.csv` or `PPRRVU.csv` from [CMS RVU26A](https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files/rvu26a) |
| CPT (DHS subset only, legacy) | `Knowledge/CPT/2025_DHS_Code_List_Addendum_11_26_2024.xlsx` (~1,299 codes; **no** 99213/99214 E/M) |
| HCPCS 2026 | `Knowledge/HCPCS/hcpc2026_jan_anweb_01122026/HCPC2026_JAN_ANWEB_01122026.txt` |

Download FY2025 ICD: https://ftp.cdc.gov/pub/health_statistics/nchs/Publications/ICD10CM/2025/ICD10-CM%20Code%20Descriptions%202025.zip

## Import order

From `middleware-platform/`:

```bash
node scripts/import-icd10-codes.js
# CPT: use Medicare Physician Fee Schedule (not DHS-only) so E/M codes 99202–99215 exist
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
# After RVU26A download: node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/RVU26A.csv
node scripts/import-hcpcs-codes.js
node scripts/populate-code-embeddings.js --type cpt --incremental --until-done --batch-size 5000
node scripts/populate-code-embeddings.js --until-done --batch-size 5000   # full icd+hcpcs if first run
```

**CPT vs fee schedules:** `import-cpt-codes.js --source mpfs` fills `cpt_codes` (descriptions for coding search). `import-mpfs-medicare.js` fills `fee_schedules` (allowed amounts). E/M rows often have $0 in the RVU payment columns and may be skipped from fees but are still imported into `cpt_codes`.

### Semantic search (voice + local coding)

Set before relying on embeddings in production (eval also benefits from parity with voice):

```bash
SEMANTIC_SEARCH_ENABLED=true
```

### Background / unattended embeddings (macOS)

```bash
npm run embeddings:daemon
npm run embeddings:daemon:status
npm run embeddings:daemon:stop
```

Log: `middleware-platform/tmp/embeddings-daemon.log`

### Accuracy eval + CPT audit

```bash
# Fast regression (keyword + phrase + dual-source; matches voice default)
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding
npm run audit:eval-cpt
npm run verify:prod-codebook
```

Report: `tmp/coding-accuracy-report.json`. Run `npm run audit:eval-cpt` to confirm expected CPTs exist in `cpt_codes` before blaming retrieval logic.

### Remote coding (Pinecone, no static export)

Voice and eval use `getCodeCandidatesDualSource`: local SQLite + live **Pinecone** (`pinecone-code-metadata-client`). Do not require `Knowledge/RAG/knowledge_export.json`. Set `RAG_API_URL=disabled` in production unless a Colab Flask proxy is explicitly deployed.

Lay-language phrase maps: `Knowledge/rules/lay-language-icd-expansions.json`. ICD term fixes: `Knowledge/RAG/icd10_term_corrections.json`.

Production env: [RENDER_PRODUCTION_CHECKLIST.md](./RENDER_PRODUCTION_CHECKLIST.md). DB parity: [PROD_DB_PARITY.md](./PROD_DB_PARITY.md).

## Stedi claim type (837P vs 837I)

Telehealth professional claims require **837P** submission. Default in code is `institutional` until you switch:

```bash
STEDI_CLAIM_SUBMISSION_MODE=professional
```

Set in `.env` before production claim submit. See `InsuranceService.getStediClaimSubmissionMode()` in `services/insurance-service.js`.

## Stedi claim-status webhook

Register in the [Stedi dashboard](https://www.stedi.com/) (production):

`https://api.myskinandcare.com/webhooks/stedi/claim-status`

Set `STEDI_WEBHOOK_SECRET` in Render/middleware `.env` to match Stedi if HMAC verification is enabled. Handler: `routes/stedi-webhooks.js`.

**Checklist (ops):**

1. Create webhook in Stedi → URL above → copy signing secret.
2. Render middleware service → Environment → `STEDI_WEBHOOK_SECRET` = signing secret.
3. Redeploy middleware.
4. `npm run verify:stedi-env` on prod host (optional).
5. Submit a test claim status event in Stedi; confirm `code_acceptance_rates` updates in logs/DB.

## NPPES directory → provider taxonomy

After `nppes_directory_providers` is populated (~1.7M rows):

```bash
node scripts/run-provider-registry-npi-dedup.cjs --include-directory --directory-all
# or: npm run payor:npi-dedup-directory
```

## MPFS fee schedules

```bash
# Download CMS PFS CSV, then:
node scripts/import-mpfs-medicare.js --file /path/to/PPRRVU.csv
```

## Ops scripts

```bash
node scripts/resubmit-telehealth-claims.cjs              # dry-run
node scripts/resubmit-telehealth-claims.cjs --execute
node scripts/run-provider-registry-npi-dedup.cjs --limit 50000
node scripts/poll-claim-statuses.cjs --hours 24
npm run eval:coding
```

Verify:

```bash
sqlite3 data/middleware-dev.db "SELECT COUNT(*) FROM icd10_codes; SELECT COUNT(*) FROM cpt_codes; SELECT COUNT(*) FROM hcpcs_codes;"
```

## Flask RAG CPT fix (Render)

Deploy the handler patch from `Knowledge/RAG/flask-retrieve-cpt-patch.py` into `medical-rag-api` `/api/retrieve` so `cpt_codes` chunk metadata is aggregated like ICD.
