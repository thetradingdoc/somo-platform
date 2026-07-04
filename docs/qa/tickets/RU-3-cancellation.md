# RU-3-cancellation — open

**Priority:** P1 (cancel)  
**Evidence:** **0/3** automated majority (2026-07-04 strict eval)

## Symptom

Russian caller requests cancel (`Мне нужно отменить приём`), then asks about cancellation fee — **not** a reschedule. Harness expects `cancel_appointment` and disposition `cancelled`.

## Likely cause

Lookup-first cancel deferral (`cancel_find_pending`) may prevent `cancel_appointment` from executing within the two-turn scenario window.

## Artifacts

- `middleware-platform/test-results/multilang-conversation-eval/RU-3-cancellation.json`
- Registry: [dental-front-desk.cjs](../../../middleware-platform/e2e/scenario-registry/dental-front-desk.cjs)

## Acceptance

`cancel_appointment` succeeds; disposition `cancelled`; fee question answered without breaking cancel flow.
