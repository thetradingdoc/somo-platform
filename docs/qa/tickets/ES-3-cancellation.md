# ES-3-cancellation — open

**Priority:** P1 (cancel / reschedule)  
**Evidence:** **0/3** automated majority (2026-07-04 strict eval)

## Symptom

Spanish caller cancels then asks to reschedule (`¿Podemos cambiarla para la próxima semana?`). Harness expects `reschedule_appointment` and non-cancel-only reply (same pattern as EN-2).

## Likely cause

Cancel deferral (`cancel_find_pending`) and EN-2 pivot patterns may not fully cover Spanish `cambiarla` / `próxima semana` on turn 2 after lookup-first turn 1.

## Artifacts

- `middleware-platform/test-results/multilang-conversation-eval/ES-3-cancellation.json`
- Registry: [dental-front-desk.cjs](../../../middleware-platform/e2e/scenario-registry/dental-front-desk.cjs)

## Acceptance

Same as EN-2: `reschedule_appointment` in `toolsUsed`; reply is reschedule confirmation (Spanish), not cancel-only.
