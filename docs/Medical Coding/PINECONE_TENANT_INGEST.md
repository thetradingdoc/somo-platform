# Pinecone tenant ingest schema (MT-01 / MT-05)

> **Last updated:** 2026-07-10  
> **Script:** `middleware-platform/scripts/pinecone-code-metadata-ingest.cjs`  
> **Filter:** `services/layer2-rag/pinecone-tenant-filter.js` (`allowsPineconeMatchForClinic`)

## Purpose

Upsert SQLite `code_embeddings` rows into Pinecone with metadata that supports multitenant retrieval. Global codebook vectors have no `clinic_id`; tenant-specific overlays must include `clinic_id` or the ingest script rejects them.

## Chunk kinds

| `chunk_kind` | `clinic_id` | Query behavior |
|--------------|-------------|----------------|
| `global` | omitted | Included for all clinics (MT-03 global pass-through) |
| `tenant` | **required** | Included only when `metadata.clinic_id === query clinicId` |

## Vector ID format

```
{chunk_kind}:{tenant_or_global}:{code_type}:{CODE}
```

Examples:

- `global:global:icd10:K29.70`
- `tenant:clinic-a:cpt:99213`

## Metadata schema

| Field | Required | Description |
|-------|----------|-------------|
| `chunk_kind` | yes | `global` or `tenant` |
| `code_type` | yes | `icd10`, `cpt`, `hcpcs`, `cdt`, `icd10_pcs` |
| `code` | yes | Normalized code value |
| `icd10_codes` | when ICD | Aggregated field read by `pinecone-code-metadata-client` |
| `cpt_codes` | when CPT/CDT | Aggregated field read by client |
| `hcpcs_codes` | when HCPCS | Aggregated field read by client |
| `clinic_id` | tenant only | SaaS clinic scope; ingest **rejects** tenant rows without it |
| `description_text` | optional | Lay description at ingest time |
| `source` | yes | Always `code_embeddings` for this pipeline |

## Ingest commands

From `middleware-platform/`:

```bash
# Global codebook (shared across tenants)
node scripts/pinecone-code-metadata-ingest.cjs --chunk-kind global --limit 5000

# Tenant overlay for a single clinic
node scripts/pinecone-code-metadata-ingest.cjs --chunk-kind tenant --clinic-id clinic-a --limit 500

# Dry-run validation
node scripts/pinecone-code-metadata-ingest.cjs --chunk-kind tenant --clinic-id clinic-b --dry-run
```

Requires `OPENAI_API_KEY` only for embedding generation (populate step). Ingest reads existing `embedding_json` from SQLite and needs `PINECONE_API_KEY` + `PINECONE_INDEX_HOST`.

## Populate → export → ingest hook (MT-05)

After `populate-code-embeddings.js` fills SQLite:

```bash
# Export JSONL chunks (global)
node scripts/populate-code-embeddings.js --export-pinecone-chunks \
  --chunk-kind global --out tmp/pinecone-global.jsonl --limit 5000

# Export tenant-tagged chunks
node scripts/populate-code-embeddings.js --export-pinecone-chunks \
  --chunk-kind tenant --clinic-id clinic-a --out tmp/pinecone-clinic-a.jsonl --limit 500

# Upsert exported file
node scripts/pinecone-code-metadata-ingest.cjs --from-export tmp/pinecone-clinic-a.jsonl
```

Each exported row includes `chunk_kind`, optional `clinic_id`, `code`, `code_type`, `description_text`, and `embedding_json`.

## Re-index checklist

1. Run codebook imports per [OPERATIONS.md](./OPERATIONS.md).
2. `node scripts/populate-code-embeddings.js --until-done` on target DB.
3. Upsert global namespace, then per-clinic tenant overlays.
4. Verify with `npm test -- pinecone-tenant-isolation.test.js`.
5. Run spine verifiers with `RAG_API_URL=disabled` and Pinecone env set.

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) §5.3.1 — Pinecone re-index
- [BENEFITS_PRECEDENCE.md](./BENEFITS_PRECEDENCE.md) — unrelated to ingest; benefits SSOT
- `pinecone_tenant_filter_reject` metric — emitted when query-time filter excludes cross-tenant matches (MT-06)
