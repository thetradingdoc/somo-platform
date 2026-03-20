# Runbook: Kelly Loop Debugging

Use this when Kelly repeats OPQRST, specialist summary, or checkout prompts.

## Symptoms

- Repeated OPQRST questions after user already answered.
- Repeated "benefit from seeing specialist" instead of checkout progression.
- Max turns exhausted without reaching payment step.

## Checklist

1. Confirm triage flags in `triage_sessions`:
   - `opqrst_complete`
   - `triage_complete`
   - `intake_complete_at`
2. Confirm `run_triage_rag` output:
   - `target_specialty` exists
   - confidence threshold logic not blocking progression
3. Inspect `toolsUsed` order:
   - expected booking path:
     - `get_available_slots`
     - `schedule_appointment`
     - `create_appointment_checkout`
4. Check weekend date normalization:
   - ensure schedule date is weekday-normalized before booking.
5. Check LLM history conversion:
   - ensure no empty user messages reaching Anthropic payload conversion.

## Fast triage/booking sanity test

- Run: `bash scripts/run-single.sh back_pain_en`
- Expected:
  - slots offered
  - scheduling succeeds
  - checkout tool invoked

## Routine intent sanity test

- Run: `bash scripts/run-single.sh routine_en`
- Expected:
  - routine prompt path at turn 1
  - no deadlock in OPQRST gates

## Typical root causes

- state gates requiring fields that are not yet persisted
- date/business-day validation retries
- message conversion payload issues
- missing session metadata for checkout verification

## Team handoff checklist

Before handing a fix to another developer, include:

1. failing case id and log excerpt,
2. exact tool sequence observed,
3. triage session flags at failure point,
4. whether failure occurs on chat, voice, or both,
5. command used to verify the fix.
