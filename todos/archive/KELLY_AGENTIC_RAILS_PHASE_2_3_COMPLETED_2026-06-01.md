# Kelly Agentic Rails — Phases 2–3 (hybrid host archive)

**Date:** 2026-06-01  
**Alias:** See also [`KELLY_AGENTIC_RAILS_PHASE_2_7_COMPLETED_2026-06-01.md`](./KELLY_AGENTIC_RAILS_PHASE_2_7_COMPLETED_2026-06-01.md) for full Phases 2–7 scope.

## Hybrid architecture

LangGraph (`kelly-conversation-graph.js`) owns **routing** and **branch_step** meta; `KellyAgentService.processTurn` executes each turn with **`graphHost`** (`kelly-graph-host.js`) for forced phases, Step1 skip, and pay guardrails.

Entry: `kelly-turn-resolver.js` → `runKellyConversationTurn` when `shouldUseKellyGraph` (after optional `KELLY_RAILS_V2`).

## Phase 2–3 highlights

- `clinicClinicalMinimumIntakeMet` — OPQRST without skin type for non-derm / clinic visits
- Step1 skip via `graphHost.clinicalIntake` / `_shouldSkipStep1ForTurn`
- Case summary at book: `case-summary-service.js` from `schedule_appointment`
- Pay: billing fast-path bypass + `_maybePaymentLinkGuardrail`; payment step meta `payment_start` → `send_link` → `verify_pay` → `finish_pay`
- P3-6: pay token cleared on session wipe (triage service + E2E fixtures)

## E2E

```bash
export KELLY_RAILS_V2=0
export LANGGRAPH_KELLY_ROLLOUT_PCT=1
RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:conversation
```
