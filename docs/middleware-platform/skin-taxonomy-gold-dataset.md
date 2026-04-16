# Skin Taxonomy Gold Dataset Plan

## Source
- Pro-verified dermatology Q/A corpus.
- Internal curated conversation transcripts.

## Label set
- `skin_type` (single label)
- `skin_condition[]` (multi-label)
- `pigment_risk` (low/medium/high)
- `conflict_labels[]`
- `next_action_class`

## Annotation protocol
- 2 independent annotators per sample.
- Adjudication pass for disagreements.
- Keep evidence spans for auditability.

## Deliverables
- `gold_skinmap_v1.jsonl`
- `gold_skinmap_v1_eval.json`
- changelog with taxonomy version mapping.
