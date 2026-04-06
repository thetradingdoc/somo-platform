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

## Session wipe + harness IDs (Fix 2)

- **Server** (`handlePatientTriageMessage`): clinical state is cleared via `wipeChatSessionClinicalState` only when there is **no** `patient_orchestrate_sessions` row for `session_id` **or** `turn_count === 0`. We do **not** wipe when `turn_count >= 1` and RAG is still missing (would nuke in-progress OPQRST).
- **Harness** (`run-kelly-tests.sh`): each run sets `KELLY_SESSION_ID="k-${case_id}-$(uuidgen)"` so a shared dev SQLite file does not reuse stale `triage_rag_results` for the same string id.

## LLM + SQLite alignment (harness vs server)

- **Claude default, Groq fallback:** `KELLY_PRIMARY_PROVIDER` defaults to `anthropic` when `ANTHROPIC_API_KEY` is set (`services/llm-router.js`). Set `KELLY_PRIMARY_PROVIDER=groq` for Groq-only.
- **Env template:** see repository `middleware-platform/.env.example`.
- **Same DB file:** the Kelly script uses `DB_FILE` (default `middleware-dev.db`). The running server must use the same SQLite file (`DB_PATH` or default from `database.js`). On health check, the harness calls `GET /health?show_db_path=1` and warns if the **basename** of the server DB differs from `DB_FILE`.
- **`toolsUsed` / tool order:** blocked `get_available_slots` (triage not ready) is **not** appended to `toolsUsed` — only successful slot lookups count for E2E ordering metrics.

## Harness behavior (billing + language)

- **`billing_en`:** exits after one billing-relevant assistant reply (no forced checkout). If the last reply never addresses billing, the case fails with `billing_intent_not_addressed`.
- **Degraded LLM replies** (rate limits, “high demand”, timeouts): non-English cases do not fail `language_correct` purely on English boilerplate (`is_degraded_llm_reply` in `run-kelly-tests.sh`).

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

## LLM + tools deep debug

See **`docs/debug-llm-kelly-path.md`** (failure modes, `KELLY_DEBUG_TURN`, DB alignment, rate-limit vs tool-order).

## Team handoff checklist

Before handing a fix to another developer, include:

1. failing case id and log excerpt,
2. exact tool sequence observed,
3. triage session flags at failure point,
4. whether failure occurs on chat, voice, or both,
5. command used to verify the fix.
