# Kelly Agentic Rails — Phases 2–7 (implementation archive)

**Date:** 2026-06-01  
**Scope:** Bridge + graph wiring, intake/pay guardrails, case summaries at book, provider clinical-prep, E2E hardening.

## Delivered

| Area | Files / behavior |
|------|------------------|
| **Bridge (W5)** | `kelly-conversation-bridge.js` + `kelly-graph-host.js` + `kelly-turn-resolver.js` — hybrid graph routes → `processTurn({ graphHost })` |
| **Graph (O4)** | `kelly-conversation-graph.js` — branch entry nodes, reschedule → `clinical_intake`, LangSmith `runName` `kelly_{branch}_{step}` |
| **Intake (I2)** | `_shouldSkipStep1ForTurn` in `kelly-agent-service.js`; `clinicClinicalMinimumIntakeMet` / `clinicMinimumIntakeMet` in `kelly-orchestrator-phase.js` |
| **Pay (P3)** | `_maybePaymentLinkGuardrail`, billing fast-path bypass for pay-now / `payment_line`; F2 T6 requires `request_patient_payment` + fresh `rcm_pay_token` |
| **Case summary (I2-5)** | `case-summary-service.js` — persist on `schedule_appointment` success |
| **Provider (V6)** | `clinical-prep-session-resolve.js`; admin clinical-prep + `/api/provider/case-report` prefer `case_summaries` |
| **Entrypoints** | `retell-websocket.js`, `kelly-triage-turn-service.js` use bridge when `shouldUseKellyGraph` |
| **E2E** | `LANGGRAPH_KELLY_ROLLOUT_PCT=1` default in F2 script; `run-rcm-e2e-suite.cjs` includes F2 (best-effort) |
| **Tests** | `kelly-conversation-bridge.test.js`, `clinical-prep-session-resolve.test.js`, router reschedule + orchestrator clinical intake |

## Dev / E2E env

```bash
export LANGGRAPH_KELLY_ROLLOUT_PCT=1
export RCM_E2E_USE_EXISTING_SERVER=1
RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:conversation
```

Optional OBGYN message set: `KELLY_E2E_OBGYN=1`.

## Not verified in CI this session

- **E7-1** F2 full green (cold-start LLM ~6–7 min/turn; run locally with keys + server on :4000).
- **E7-2** Playwright live Stripe (optional).
- **V6-3** Manual provider-shell staging checklist.

## Escape hatch

`LANGGRAPH_KELLY_ENABLED=0` disables graph routing; legacy `processTurn` only.
