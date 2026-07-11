# Medical Coding — Operations Runbook

> **Last updated:** 2026-07-10  
> **Tasks:** CODING-FOUNDATION B-10, E-07, N-11  
> **See also:** [CODEBOOK_REFRESH_CALENDAR.md](./CODEBOOK_REFRESH_CALENDAR.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

## Dev import chain

From `middleware-platform/` with `DB_PATH=./var/db/middleware-dev.db`:

```bash
export SKIP_STARTUP_MIGRATIONS=1
node scripts/import-icd10-codes.js
node scripts/import-cpt-codes.js --source mpfs
node scripts/import-hcpcs-codes.js
node scripts/import-mpfs-medicare.js
node scripts/import-cdt-codes.js
npm run verify:codebook-parity
npm run verify:prod-codebook
```

## Embeddings

```bash
node scripts/populate-code-embeddings.js --until-done --batch-size 5000
node scripts/populate-code-embeddings.js --type cdt --incremental --until-done
node scripts/backfill-code-embeddings-specialty.js
```

Requires `OPENAI_API_KEY`. Pin model via `EMBEDDING_MODEL` (see ARCHITECTURE.md §5.3).

## Eval profiles

| Profile | Command | When |
|---------|---------|------|
| Fast (CI/PR) | `npm run eval:coding:fast` | Keyword-only; `RAG_API_URL=disabled` |
| Prod parity | `npm run eval:coding:prod` | Semantic + Pinecone on; nightly |
| CPT coverage | `npm run audit:eval-cpt` | Per-category CPT prefix audit |

Report: `middleware-platform/tmp/coding-accuracy-report.json`

## GCS prod DB pull/push

**Pre-import backup:**

```bash
gsutil cp gs://somo-staging-db-somo-callsomo/middleware-staging.db \
  gs://somo-staging-db-somo-callsomo/backups/middleware-pre-codebook-$(date +%Y%m%d-%H%M%S).db
```

**Download for local verify:**

```bash
node scripts/cloudrun-db-sync.cjs download
```

**Upload after verified import:**

```bash
node scripts/cloudrun-db-sync.cjs upload
```

See [../deployment/PROD_DB_PARITY.md](../deployment/PROD_DB_PARITY.md).

## MPFS ↔ lay-language upkeep (E-07)

When CMS publishes new MPFS RVU files:

1. Re-run `import-cpt-codes.js --source mpfs` and `import-mpfs-medicare.js`
2. Review `Knowledge/rules/lay-language-icd-expansions.json` for new E/M shorthand ("Office o/p est low 20 min")
3. Run `npm run eval:coding:fast` and `npm run audit:eval-cpt`
4. Update golden cases if specialty prefixes shift

## Deploy gates

```bash
PINECONE_DEPLOY_GATE=1 npm run verify:prod-codebook
npm run verify:kelly-rails-cloudrun
CLOUDRUN_PROFILE=production CONVERSATION_MODE_ROUTING=enforce npm run verify:env-gates
npm run capture:coding-prod-evidence
```

Confirm `KELLY_RAILS_FAST_RAG=0`, `RAG_API_URL=disabled`, Pinecone env set per `generate-cloudrun-env-yaml.cjs`.

Post-deploy: archive `var/evidence/coding-prod/` with release tag.

## Benefit ingest (C-BR, manual — no Stedi 271 automation)

Schema: [Knowledge/rules/plan-rules-benefit-schema.json](../../Knowledge/rules/plan-rules-benefit-schema.json)

```bash
node scripts/import-plan-rules-benefits.cjs ../Knowledge/rules/plan-rules-benefit-sample.json
```

## Provider / location copay (C-PL)

Phase 1: **defer** — Kelly blocks location/provider-specific quotes (`resolve-amount-due.js` + `journey-gates-service.checkLocationQuoteGate`). Front desk confirms copay.

## Staging spine verification (K-06)

```bash
DB_PATH=./var/db/middleware-staging.db EVAL_USE_SEMANTIC=true node scripts/verify-live-spine.cjs
DB_PATH=./var/db/middleware-staging.db USE_TRIAGE_RAG_V2=1 EVAL_USE_SEMANTIC=true node scripts/verify-triage-spine.cjs
```

## Rollback

If an import corrupts prod mid-cutover:

1. Stop API instances
2. Restore latest GCS backup from `backups/`
3. Re-upload via `cloudrun-db-sync.cjs upload`
4. Run `verify:prod-codebook` on restored DB

See ARCHITECTURE.md rollback section and [../compliance/CODEBOOK_LICENSING.md](../compliance/CODEBOOK_LICENSING.md).

---

## Appendix — PSTN tenant isolation spot-check (MT-09)

Optional prod evidence after deploy (Appendix A Step 4 style). Confirms voice/PSTN paths pass `clinicId` into dual-source retrieval and exclude cross-tenant Pinecone chunks.

### Prerequisites

- Two provisioned clinics with distinct DIDs (`clinic-a`, `clinic-b` or prod equivalents)
- Pinecone tenant overlays ingested per [PINECONE_TENANT_INGEST.md](./PINECONE_TENANT_INGEST.md)
- `npm run verify:pinecone-deploy-env` exit 0

### Spot-check steps

1. **Place test call to clinic A DID** — use a coding-eligible reason (e.g. "annual checkup" for primary care or "cleaning" for dental).
2. **Inspect call log** — confirm `voice_call_log.clinic_id` matches clinic A and `customer_id` links via `customer_clinics`.
3. **Query triage projection** — `triage_sessions` / `kelly_rails_session_projection` rows for the call session show the same `clinic_id`.
4. **Pinecone isolation** — in logs or debug, confirm retrieval used clinic A's `clinicId`; no clinic B CPT/ICD from tenant-tagged chunks.
5. **Repeat for clinic B DID** — different starter set / codes; no bleed from clinic A tenant vectors.
6. **SQLite boundary audit** (local or prod snapshot):
   ```bash
   DB_PATH=./var/db/middleware-prod.db npm run verify:sqlite-tenant-boundary
   ```

### Pass criteria

| Check | Expected |
|-------|----------|
| Session `clinic_id` | Matches called DID's clinic |
| `customer_clinics` link | No cross-tenant bleed rows |
| Pinecone matches | Global chunks OK; tenant chunks match query clinic only |
| Admin starter set | Per-clinic profile from `CLINIC_STARTER_SET_MAP` when admin path |

**Verified by:** _______________ **Date:** _______________  
**Evidence path / link:** _______________
