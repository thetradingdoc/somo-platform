"""
Example Flask /api/retrieve handler — integrate into medical-rag-api on Render.
Requires: flask, pinecone client, openai embeddings (match your existing RAG service).
"""

from flask import Flask, request, jsonify

# from your_app.pinecone import query_index
# from flask_retrieve_cpt_patch import aggregate_codes_from_matches

app = Flask(__name__)


@app.post("/api/retrieve")
def retrieve():
    body = request.get_json(force=True) or {}
    query = (body.get("query") or "").strip()
    top_k = int(body.get("top_k") or 20)
    if not query:
        return jsonify({"icd10": [], "cpt": [], "hcpcs": []})

    # matches = query_index(query, top_k=top_k)  # your existing implementation
    matches = []  # placeholder

    icd10 = aggregate_codes_from_matches(matches, "icd10_codes")
    cpt = aggregate_codes_from_matches(matches, "cpt_codes")

    return jsonify({"icd10": icd10, "cpt": cpt, "hcpcs": []})
