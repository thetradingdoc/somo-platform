# ES-1-booking — resolved

**Status:** Resolved 2026-07-04  
**Evidence:** **3/3** automated majority (`MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1`)

## Original symptom (2026-07-03)

Spanish family-caller books cleaning for son. Slots offered on turn 1; intake on turn 2; confirm utterance re-offered slots instead of calling `schedule_appointment`.

## Fix (phase 3)

- Schedule gate on name/insurance turn when `slots_offered`
- `resolveBookingSlot` preserves offered date on confirm
- Dental routine `schedule_appointment` path

## Artifacts

- `middleware-platform/test-results/multilang-conversation-eval/ES-1-booking.json`
- Scoreboard: [dental-pilot-readiness.md](../dental-pilot-readiness.md)
