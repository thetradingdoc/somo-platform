"""
Deploy into medical-rag-api (Render) /api/retrieve handler.

Aggregates cpt_codes from Pinecone match metadata the same way as icd10_codes.
Paste the aggregation helpers into your existing retrieve route after query results.
"""

from collections import Counter
from typing import Any


def _split_metadata_codes(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        parts = value
    else:
        parts = str(value).replace(";", ",").split(",")
    out = []
    for p in parts:
        code = str(p).strip().upper()
        if code and code not in out:
            out.append(code)
    return out


def aggregate_codes_from_matches(matches: list, field: str) -> list[dict]:
    """
    field: 'icd10_codes' or 'cpt_codes'
    Returns [{ code, description, score }] ranked by frequency then max score.
    """
    counts: Counter[str] = Counter()
    max_score: dict[str, float] = {}

    for match in matches or []:
        meta = (match.get("metadata") or {}) if isinstance(match, dict) else {}
        score = float(match.get("score") or 0)
        for code in _split_metadata_codes(meta.get(field)):
            counts[code] += 1
            max_score[code] = max(max_score.get(code, 0.0), score)

    ranked = sorted(counts.keys(), key=lambda c: (-counts[c], -max_score.get(c, 0.0)))
    return [
        {
            "code": code,
            "description": "",
            "score": max_score.get(code, 0.0),
        }
        for code in ranked
    ]


# Example integration in Flask route:
#
#   results = index.query(vector=embedding, top_k=top_k, include_metadata=True)
#   matches = results.get("matches") or []
#   icd10 = aggregate_codes_from_matches(matches, "icd10_codes")
#   cpt = aggregate_codes_from_matches(matches, "cpt_codes")
#   return jsonify({"icd10": icd10, "cpt": cpt, "hcpcs": []})
