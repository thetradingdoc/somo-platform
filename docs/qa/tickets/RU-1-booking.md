# RU-1-booking — resolved

**Status:** Resolved 2026-07-04  
**Evidence:** **3/3** automated majority (`MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1`)

## Original symptom (2026-07-03)

Russian exam booking. Confirm utterance (`Да, вторник днём подходит.`) re-fetched slots instead of `schedule_appointment`.

## Fix (phase 3)

- Cyrillic confirm patterns without `\b` word boundaries
- `passesLocalizedBookConfirm` in schedule gate
- Slot loop guard when `wantsBookConfirm` + bound slot

## Artifacts

- `middleware-platform/test-results/multilang-conversation-eval/RU-1-booking.json`
- Scoreboard: [dental-pilot-readiness.md](../dental-pilot-readiness.md)
