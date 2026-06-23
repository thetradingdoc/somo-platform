# OPQRST Completion Audit

Inventory of all `opqrstComplete` / equivalent logic before Field Gate unification.

## Three incompatible implementations (pre-migration)

| Location | Logic | Issue |
|----------|-------|-------|
| `kelly-tool-executor.js` `_storeTriageOpqrst` | onset + quality + severity + timing | No region; no provocation |
| `kelly-rails/gates/shared.js` | + region or rash keyword heuristic | Different from executor |
| `kelly-rails/execute-turn.js` (local duplicate) | Same as shared.js | Duplicate |
| `kelly-rails/state-schema.js` `opqrstOk` | region required inline | Third variant |

## Migration target

Single function: `opqrstComplete(row, { triagePolicy, specialty })` in [opqrst-field-gate.js](../../middleware-platform/services/opqrst-field-gate.js)

Default: onset + quality + severity + timing  
`required` policy: + provocation

## Consumer migration checklist

| File | Action | Status |
|------|--------|--------|
| `services/opqrst-field-gate.js` | Canonical implementation | Done |
| `services/kelly-tool-executor.js` `_storeTriageOpqrst` | Import gate `opqrstComplete` | Done |
| `services/kelly/rails/gates/shared.js` | Re-export from gate | Done |
| `services/kelly/rails/execute-turn.js` | Remove local fn; import shared; policy via `opqrstCompleteForSession` | Done |
| `services/kelly/rails/state-schema.js` `routeOrchestratorLane` | Use `opqrstCompleteForSession` with clinic context | Done |
| `services/kelly/rails/gates/opqrst.js` | Via shared import | Done |
| `services/kelly/rails/gates/clinical.js` | Via shared import | Done |
| `services/voice-triage-guards.js` | Trust DB `opqrst_complete` flag from store | Verified |
| `services/kelly-orchestrator-phase.js` | Reads DB flag only | Verified |
| `services/kelly-agent-service.js` | Gate capture when flag on; reads DB `opqrst_complete` for RAG trigger | Done |

## A-2 — duplicate removal

No local `opqrstComplete` in `execute-turn.js`; imports via `gates/shared` → `opqrst-field-gate.js`.

## A-3 — parity tests

`__tests__/opqrst-complete-parity.test.js` covers gate/shared agreement, reroute preservation, `promoteBookingWhenReady`, `routeOrchestratorLane` booking gate, voice-triage-guards DB flag, and store-path alignment (13 tests).

When `OPQRST_FIELD_GATE_ENABLED=0`/`false`: legacy L4 step formatter, capture guard, allowlists (F-1 rollback).

When `OPQRST_FIELD_GATE_ENABLED=1` or unset (default): gate drives formatter, capture, allowlists, execute-turn.
