# Phase 3 — Derm patient education corpus & retrieval

Patient-facing answers need **passage** retrieval, parallel to the **code-oriented** Colab `/retrieve` path used for ICD/CPT.

## P3.1 Corpus strategy

- **Content**: derm-first chunks (guidelines, approved briefs, vetted excerpts). Forums and raw social text are out of scope for the default index.
- **Versioning**: canonical manifest at [`Knowledge/corpus/derm-education/manifest.json`](../../../Knowledge/corpus/derm-education/manifest.json) (`corpus_id`, `version`, `owner`, chunking policy).
- **Ownership**: clinical content governance is a process responsibility (review cadence, source list); engineering owns the **index contract** and middleware client.

## P3.2 Index contract — `POST /retrieve_passages`

Implement on Colab (or a dedicated education service). Middleware calls **`RAG_EDUCATION_URL`** (see architecture overview); if unset, falls back to the same base as **`RAG_API_URL`** with path `/retrieve_passages`.

### Request (JSON)

| Field | Type | Description |
| --- | --- | --- |
| `query` | string | Primary retrieval string (may already include lay↔clinical expansion). |
| `specialty` | string | e.g. `dermatology`. |
| `region` | string | e.g. `US`. |
| `top_k` | number | Max passages. |
| `filters` | object | Optional: `pediatric`, `pregnancy`, `corpus_version`. |
| `hybrid` | object | Optional: `dense_query`, `bm25_terms[]` for backends that support hybrid retrieval. |
| `exclusion_terms` | string[] | Same spirit as code RAG. |

### Response (JSON)

| Field | Type | Description |
| --- | --- | --- |
| `passages` | array | Items: `id`, `text`, `source_id`, optional `source_title`, `specialty`, `score` (0–1), optional `metadata`. |
| `metadata` | object | Optional: `index`, `version`, `backend`. |

Empty `passages` is valid; callers fall back to non-RAG behavior.

## P3.3–P3.5 Middleware behavior

Implemented in `middleware-platform/services/layer2-rag/`:

- **Hybrid**: client sends `hybrid` when expansion yields extra terms; single-query backends can concatenate (see `patient-education-client.js`).
- **Query construction**: `patient-education-query.js` — expansions from `Knowledge/rules/derm-lay-clinical-expansions.json`; optional HyDE (guarded for vague/short queries).
- **Reranking**: `patient-education-passage-rerank.js` — lexical overlap rerank on query–passage pairs when the remote does not rerank.

## P3.6 Integration

- **Client**: `patient-education-client.js` — `retrievePatientEducationPassages`, `retrievePatientEducationForDermQA` (respects Phase 2 `retrieval_policy`).
- **Proxy**: `POST /api/rag/retrieve_passages` forwards to Colab `/api/retrieve_passages` or `/retrieve_passages`.
- **Env**: documented in [`ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`](../ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md) (`RAG_EDUCATION_URL` vs `RAG_API_URL`).
