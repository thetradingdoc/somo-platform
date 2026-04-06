# Phase 4 — Answer generation and safety

Implements **prompt templates**, **grounding**, **citations**, **image disclaimers**, and **corpus content policy** hooks before any LLM call.

## P4.1 Prompt / template library

- File: [`Knowledge/prompts/derm-patient-qa-templates.json`](../../../Knowledge/prompts/derm-patient-qa-templates.json)
- Intent keys: `urgent`, `education`, `routine`, `off_topic`, `clarify` (from triage: urgent / education / routine / off_topic / needs clarification).
- Fixed sections: what evidence supports, limits, next step — embedded in each system template.

Loader: `middleware-platform/services/derm-patient-qa-answer.js` (`loadTemplates`, `composeFromParts`).

## P4.2 Grounding rules

- Module: `middleware-platform/services/derm-patient-qa-grounding.js`
- `assessPassageGrounding({ query, passages })` scores each passage by query token overlap; if **best score** is below `DERM_QA_GROUNDING_MIN_SCORE` (default `0.14`), composition uses **abstain** mode with `abstain_reason: evidence_mismatch` instead of implying unrelated excerpts apply.
- If retrieval returns no passages for education/routine (and retrieval was not skipped by policy), mode **`no_passages`** abstain.
- If all passages were dropped as spam, **`spam_filtered`**.

## P4.3 Citations

- `middleware-platform/services/derm-patient-qa-citations.js` — `buildCitationList`, `formatCitationsBlock`.
- API responses include **`citations`** (debug adds previews) and **`citations_for_ui`** (label, `source_id`, `id`) for Phase 8 UI.

## P4.4 Image path

- `middleware-platform/services/derm-patient-qa-image.js` — `CANNOT_DIAGNOSE_FROM_IMAGE`, `buildImageBlockForPrompt`, `buildRetrievalFacingText` (message + caption for retrieval alignment).

## P4.5 Content policy

- Rules: [`Knowledge/rules/derm-corpus-content-policy.json`](../../../Knowledge/rules/derm-corpus-content-policy.json)
- `middleware-platform/services/layer2-rag/patient-education-passage-rerank.js` — `rerankPassagesWithContentPolicy`: drop SEO-like chunks, boost `metadata` guideline tags.

## API

`POST /api/patient/derm-qa/compose` — patient session + CSRF. Body: `message`, optional `imageCaption`, `imagePresent`, `triage`, `retrieval`, `skip_retrieve`, `filters`, `debug` (verbose citations). Returns **`prompts.system`** / **`prompts.user`** for a downstream LLM, plus **`mode`**, **`grounding`**, **`citations_for_ui`**.

## Tests

`middleware-platform/__tests__/derm-patient-qa-phase4.test.js`
