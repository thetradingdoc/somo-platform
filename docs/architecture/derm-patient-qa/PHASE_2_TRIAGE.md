# Phase 2 — Derm patient Q&A triage

Triage runs **before** heavy passage retrieval so intent, risk, and scheduling alignment shape what is retrieved and how answers are framed.

## Inputs

| Field | Required | Description |
| --- | --- | --- |
| `message` | Yes (for API) | Raw user text |
| `imageCaption` | No | Optional vision caption when a vision path exists |
| `structuredIntake` | No | OPQRST-like object; string values are joined as `key: value` lines and included in the combined text for red-flag and scheduling checks |
| `recentTurns` | No | `{ role, content }[]` passed to `checkBeforeScheduling` when present; otherwise derived from message + caption + intake |

Implementation: `middleware-platform/services/derm-patient-qa-triage.js` (`classifyDermPatientQA`).

## Rules and taxonomy

- Global patterns: `Knowledge/rules/triage-rules.json` via `triage-service` (`detectRedFlags`, `checkBeforeScheduling`).
- Derm-specific patterns: `Knowledge/rules/derm-patient-qa-intent-rules.json` (urgent skin, vague/clarify, routine/product, off-topic).

Outputs map to Phase 0 intent buckets (`intent`, `subkind`, `phase0_taxonomy`).

## Retrieval policy

`retrieval_policy` includes `passage_retrieval` (`full` | `minimal` | `none`), `top_k`, `specialty`, `scheduling_allowed`, `short_circuit_long_answer`, and `use_code_rag`. Urgent and clarify paths use minimal or no retrieval and short-circuit long differentials.

## Scheduling consistency

`scheduling.block_scheduling` reflects `checkBeforeScheduling` so “book” vs “urgent / block” does not contradict the existing triage gates.

## Logging

Each classification includes structured `_log` (intent, subkind, systemic urgency, scheduling blocked, rationale, timestamp). Stdout logging is enabled when `DERM_QA_TRIAGE_LOG=1` or `true`.

## API

`POST /api/patient/derm-qa/triage` — patient session + CSRF (cookie auth). Body: `{ message?, imageCaption?, structuredIntake?, recentTurns? }`. Returns the classifier output plus `disclaimers` and `request_id`.

## Tests

`middleware-platform/__tests__/derm-patient-qa-triage.test.js`
