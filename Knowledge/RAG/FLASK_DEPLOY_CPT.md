# Deploy CPT aggregation to Render (`medical-rag-api`)

## Files

- Patch helpers: [`flask-retrieve-cpt-patch.py`](flask-retrieve-cpt-patch.py)
- Example integrated handler: [`flask_retrieve_handler_example.py`](flask_retrieve_handler_example.py)

## Steps

1. Copy `aggregate_codes_from_matches` and `_split_metadata_codes` from the patch file into your Flask app's `/api/retrieve` route (after Pinecone `query`).
2. Set response shape:

```python
return jsonify({
    "icd10": aggregate_codes_from_matches(matches, "icd10_codes"),
    "cpt": aggregate_codes_from_matches(matches, "cpt_codes"),
    "hcpcs": []
})
```

3. Deploy to Render and set env: `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, `OPENAI_API_KEY`.
4. Smoke test:

```bash
# Production Render service (see middleware-platform/.env COLAB_RAG_URL)
curl -s -X POST "https://medical-rag-api-0dso.onrender.com/api/retrieve" \
  -H 'Content-Type: application/json' \
  -d '{"query":"99213 office visit established patient","top_k":20}' \
  | jq '{icd: (.icd10|length), cpt: (.cpt|length)}'
```

Expect `cpt > 0` when index chunks include `cpt_codes` metadata (clinical narrative queries may return ICD-only if top matches lack CPT metadata).

Middleware falls back to direct Pinecone if Flask still returns empty CPT (`RAG_CPT_FALLBACK_PINECONE` default on).
