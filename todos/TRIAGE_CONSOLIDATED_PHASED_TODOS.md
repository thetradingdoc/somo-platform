## DocLittle Triage Roadmap — Consolidated Phased TODOs

**Date**: 2026-03-19  
**Scope**: T1–T21 (your list) + additional prompt/agent hardening tasks discovered during code review.

===

## Phase 1 — Rich History Collection (highest ROI)

- **T1 – Migration: `011_triage_rich_intake`**
  - **Status: COMPLETED**
  - Add rich-intake columns to `triage_sessions`:
    - `family_history, medications, prior_diagnoses, prior_workups, allergies, alcohol_use, substance_use, smoking_status, occupation, critical_unknowns, intake_complete_at`.

- **T2 – New tool: `store_triage_rich_intake`**
  - **Status: COMPLETED**
  - Implement in `kelly-tool-executor.js` (and expose in `kelly-agent-service.js`):
    - Inputs: `session_id`, `medications[]`, `allergies[]`, `prior_diagnoses[]`, `prior_workups`, `family_history`, `alcohol_use`, `smoking_status`, `substance_use`, `occupation`, `critical_unknowns[]`.
  - Merge into `triage_sessions` row for that `session_id` (idempotent partial upsert).

- **T3 – Prompt: Intake sequence**
  - **Status: COMPLETED**
  - Update Kelly prompt with strict intake order:
    1) Chief complaint + OPQRST → `store_triage_opqrst`
    2) Medications
    3) Known conditions
    4) Allergies
    5) Specialty-specific deep-dive questions
    6) Family/social history (incl. alcohol/smoking/occupation)
    7) `store_triage_rich_intake`
    8) `run_triage_rag` with full context.

- **T4 – Prompt: Symptom vs routine rule**
  - **Status: COMPLETED**
  - Replace “Skip triage” block so:
    - Any symptom/medical concern → MUST run OPQRST + `run_triage_rag` before `get_available_slots` (even if they say “book/general visit”).
    - Only skip triage for clearly routine/annual/admin visits with **no current symptom**.

### Additional Phase 1 tasks (prompt/data integrity)

- **P1.A — Fix `critical_unknowns` storage/parse consistency**
  - **Status: COMPLETED**
  - Ensure `triage_sessions.critical_unknowns` is stored and returned consistently (array vs string/JSON) so Kelly can treat it as a list.

===

## Phase 2 — TriageRAGService: reasoning, not just routing

- **T5 – Enrich `enrichFromSymptoms` signature**
  - **Status: COMPLETED**
  - Add `richIntake` parameter and pass it from `kelly-tool-executor._runTriageRAG` into `TriageRAGService.enrichFromSymptoms`.

- **T6 – `_buildCombinedText` uses rich intake**
  - **Status: COMPLETED**
  - Append medications, prior diagnoses, family history, alcohol_use, prior workups (and allergies) into the text sent to RAG.

- **T7 – Differential-based specialty resolver**
  - **Status: COMPLETED**
  - Add `_resolveSpecialtyFromDifferentials`:
    - Input: differential list (conditions + ICD-10).
    - Output: `primary_specialty`, `secondary_specialties[]` using `DIFFERENTIAL_SPECIALTY_MAP`.
  - Use this when RAG returns structured differentials; retain keyword/ICD prefix fallback.

- **T8 – RAG confidence computation**
  - **Status: COMPLETED**
  - Replace keyword-based `rag_confidence` with a function that:
    - Uses retrieval scores / presence of rich-intake fields.
    - Lowers confidence when key history (meds, alcohol, prior workups) is missing.

===

## Phase 3 — SOAP note + downstream artifacts

- **T9 – Rich SOAP note builder**
  - **Status: COMPLETED**
  - Replace `_buildSoapNote` with multi-section note:
    - Subjective: CC + OPQRST + associated symptoms.
    - PMH / meds / allergies / family / social / prior workups (from richIntake).
    - Assessment: specialty, urgency, safety_level, top ICD-10 candidates, critical_unknowns.
    - Plan: routing lane, next steps.
  - Store in `triage_sessions.soap_note` when `triage_complete`.

- **T10 – Multi-specialty routing UX**
  - **Status: COMPLETED**
  - When RAG returns multiple high-confidence differentials across different specialties:
    - Populate `secondary_specialties` and a human `kelly_script`.
    - Update Kelly prompt to offer optional secondary specialty (“We can also have an endocrinologist review X…”).

- **T11 – ICD/CPT mapping improvements**
  - **Status: COMPLETED**
  - Update ICD → specialty mapping to consider **all** high-confidence ICD codes.
  - Update CPT selection to be **specialty-aware** (Cardiology vs Psychiatry vs Hepatology) rather than generic defaults.

===

## Phase 4 — Prompt engineering / policy hardening

- **T12 – State machine & tool ordering**
  - **Status: COMPLETED**
  - Add explicit state machine to Kelly prompt:
    - Pre-triage → only info-collection tools.
    - Triage-in-progress → allow `store_triage_opqrst`, `store_triage_rich_intake`, `get_triage_session`, `run_triage_rag`, uploads.
    - Triage-complete → only then `get_available_slots` → `schedule_appointment` → payment.
  - Hard rule: no `get_available_slots` or `schedule_appointment` before triage-complete.

- **T13 – Upload semantics**
  - **Status: COMPLETED**
  - Clarify uploads are **additive**:
    - After upload, Kelly must continue OPQRST + rich intake and re-call `run_triage_rag` before booking.

- **T14 – Records Q&A vs triage**
  - **Status: COMPLETED**
  - Prompt: `query_patient_records` only for “what did my labs/last visit say?”.
  - Never use it for new complaints instead of OPQRST + `run_triage_rag`.

- **T15 – Safety precedence**
  - **Status: COMPLETED**
  - Add rule:
    - Emergency patterns / positive safety screen → immediately trigger emergency script.
    - Forbid `get_available_slots` / `schedule_appointment` in that conversation.

- **T16 – OPQRST for non-pain complaints**
  - **Status: COMPLETED**
  - Add guidance adapting OPQRST severity/meaning for rashes/skin, fatigue/endocrine, respiratory, psychiatry.

- **T17 – Mixed-intent ordering**
  - **Status: COMPLETED**
  - Document intent precedence:
    - Safety/emergency → triage → booking → insurance → billing.
  - In prompt: finish triage for symptomatic cases before moving on.

- **T18 – Session continuity for returning users**
  - **Status: COMPLETED**
  - On resume:
    - Call `get_triage_session`, summarize existing data, only ask for missing pieces before next `run_triage_rag`.

- **T19 – Multilingual symptom triggers**
  - **Status: COMPLETED**
  - Extend examples with non-English symptom phrases (Spanish, Swahili, etc.).
  - State they must be treated as triage-required triggers.

### Additional Phase 4 tasks (prompt drift & explicit bans)

- **P4.A — Remove/align markdown prompt drift**
  - **Status: COMPLETED**
  - Ensure `docs/voice-agent/prompts/kelly-voice-agent-prompt.md` matches the *actual* runtime `buildSystemPrompt`.
  - Remove any legacy “skip triage / go direct to booking” instructions.

- **P4.B — Make “hard ban after red safety” explicit**
  - **Status: COMPLETED**
  - Explicitly instruct: once safety is red (from detectRedFlags or safety_screen), the agent must not call any scheduling/slot/payment tools for the session.

- **P4.C — Make symptom-vs-routine negative rule explicit**
  - **Status: COMPLETED**
  - Add a clear “Do NOT skip triage if the patient mentions any current symptom” sentence (not just positive guidance).

===

## Phase 5 — Backend guardrails & observability

- **T20 – Enforce triage-complete gate in code**
  - **Status: COMPLETED**
  - Re-verify and strengthen checks in `kelly-tool-executor._getAvailableSlots` and booking routes so they refuse if:
    - `triage_complete` is false OR
    - `rag_confidence` below threshold.

- **T21 – Metrics & logging on misuse**
  - **Status: COMPLETED**
  - Add counters/logs for:
    - Attempts to call `get_available_slots` without prior `run_triage_rag`.
    - Booking/insurance calls in sessions with no OPQRST / rich intake.
  - Use metrics to validate elimination of “book without triage”.

### Additional Phase 5 tasks (safety lock + misuse telemetry)

- **P5.A — Session-level safety lock (backend)**
  - **Status: COMPLETED**
  - Persist a session safety flag on emergency/red safety.
  - Backend should return `SAFETY_BLOCKED` for slots/booking even if Kelly tries later turns.

- **P5.B — Structured “misuse reason” in tool errors**
  - **Status: COMPLETED**
  - Return consistent `error_code` + `message` payloads so metrics can group misuse by cause (e.g. `TRIAGE_REQUIRED`, `LOW_CONFIDENCE`, `SAFETY_BLOCKED`).

### New tasks for the current “rate limit + tool loop” failure mode

- **T22 — Handle `413 request too large` separately in Groq fallback**
  - **Status: COMPLETED**
  - Treat `413` as a size-limit class (not a rate-limit class).
  - On fallback retry, use a compact system prompt and keep only the last few messages to stay under smaller-model limits.

- **T23 — Break the tool-call loop on `TRIAGE_INCOMPLETE` / `LOW_CONFIDENCE`**
  - **Status: COMPLETED**
  - When `get_available_slots` returns `success:false` with `error_code` in:
    - `TRIAGE_INCOMPLETE`
    - `LOW_CONFIDENCE`
    - `TRIAGE_REQUIRED`
  - Immediately stop further tool calls for the current turn and respond with the tool’s `message` (i.e., ask the missing OPQRST/rich-intake questions instead of re-attempting slots).

- **T24 — Add explicit debug context for why `triage_complete` stays false**
  - **Status: COMPLETED**
  - Add logs/telemetry around the `run_triage_rag` computation of:
    - `opqrst_complete`
    - presence of differentials
    - presence of `target_specialty`
    - `rag_confidence` and the final computed `triage_complete`
  - This is to confirm whether the loop is caused by low confidence vs missing differentials/specialty.

- **T25 — Regression test: “book visit” without symptoms must end in OPQRST questions**
  - **Status: COMPLETED**
  - Extend the existing LLM journey scripts (or add a new one) to reproduce:
    1) user requests a booking (“book a visit”) with minimal symptom detail
    2) agent must ask clarifying OPQRST/rich-intake questions
    3) agent must NOT spam `get_available_slots` while triage is incomplete

===
## Phase 6 — Prompt UX polish for Chat (tool-name leaks + one-question-at-a-time)

- **T26 — Never show internal tool/function names to patients (Chat + Voice)**
  - **Status: COMPLETED**
  - Remove/replace any occurrences of `run_triage_rag`, `get_available_slots`, `schedule_appointment`, etc. from user-visible strings.
  - Specifically sanitize the `toolResult.message` appended in the `TRIAGE_INCOMPLETE/LOW_CONFIDENCE` guardrail.

- **T27 — Ask OPQRST one field at a time (Chat UX)**
  - **Status: COMPLETED**
  - When triage is incomplete, ask only the single most-missing OPQRST field (usually onset first), not onset+quality+severity+timing in one message.
  - Do the same for `LOW_CONFIDENCE` follow-ups: ask exactly one clarifying question.

- **T28 — Shorten/limit the opening greeting after the first turn**
  - **Status: COMPLETED**
  - After the first assistant reply, do not re-emit the full “name/language/emergency” greeting block.
  - Keep subsequent turns focused on triage questions or next-step actions.

- **T29 — “Suggested next step” sanitization**
  - **Status: COMPLETED**
  - If `run_triage_rag` returns `suggested_next_step`, extract only the human-facing question(s).
  - Strip any imperative text that mentions internal tools or function calls.

- **T30 — Add concrete symptom examples for the OPQRST loop breaker**
  - **Status: COMPLETED**
  - Add examples like “back pain”, “burning rash”, “shortness of breath” showing the first OPQRST question Kelly should ask.

- **T31 — Regression tests: “tool-name leak” + “one-question OPQRST” (Chat)**
  - **Status: COMPLETED**
  - Add/extend scripts to assert:
    - No “run_triage_rag / get_available_slots” appears in assistant replies.
    - The first triage follow-up after “triage incomplete” asks exactly one OPQRST element.

- **T32 — Chat formatting alignment with prompt rules**
  - **Status: COMPLETED**
  - Ensure chat responses remain “concise, clear” without bullet overload unless listing slot options.
  - Ensure voice constraints remain short while chat allows slightly more context.

===
## Phase 6.5 — Tool-schema stability (prevents slow fallback loops)

- **T33 — Allow `null` for `run_triage_rag.alcohol_cage_score`**
  - **Status: COMPLETED**
  - Update `kelly-agent-service.js` tool schema so Groq does not reject valid tool calls when alcohol history is missing.

- **T34 — Fast-fail to OPQRST follow-up on tool validation errors**
  - **Status: COMPLETED**
  - When `tool call validation failed` / `tool_use_failed` occurs, immediately return a triage OPQRST follow-up instead of orchestrator “generic booking” fallback.

- **T35 — Regression test: "I'm not feeling well" must enter triage**
  - **Status: COMPLETED**
  - Add `test-booking-visit-not-feeling-well-no-tool-errors.sh` to ensure we don’t fall back to generic booking due to tool schema errors.

