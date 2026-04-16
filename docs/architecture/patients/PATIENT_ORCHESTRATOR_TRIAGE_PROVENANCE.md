# Patient Orchestrator — `session_id` vs `triage_sessions` (C1 / impl-5)

## Provenance

- **`patient_orchestrate_sessions.session_id`** is the orchestrator’s own session key (chat/voice fallback flow). It is **not** automatically the same as **`triage_sessions.session_id`** (Kelly clinical session / Retell `callId`), but in **voice** flows they are often **the same string** (e.g. Retell `callId` reused as orchestrator session id).

## Product decision (implemented)

**When `db.getTriageSession(session.session_id)` returns a row**, the orchestrator runs **`evaluateTriageGuardrailsForSession(session.session_id, {}, 'schedule')`** from **`services/voice-triage-guards.js`** **before** **`BookingService.scheduleAppointment`**. This matches **`POST /voice/appointments/schedule`** DB gates (safety, triage complete, confidence, OPQRST, intake).

**When no `triage_sessions` row exists** for `session.session_id`, booking **proceeds** without those gates (orchestrator-only / non-Kelly flows). This avoids blocking flows that never created triage.

**Blocked booking:** returns a user-facing reply with `triage_guard_blocked: true` and `error_code` from the guard (e.g. `TRIAGE_INCOMPLETE`, `TRIAGE_NOT_STARTED`, `OPQRST_REQUIRED`). Ops counter: **`orchestrator_triage_guard_blocked`** (best-effort).

## Audit note

- **`autoCheckoutAfterSchedule`** forwards **`triage_session_id: session.session_id`** for HTTP audit — correlation only, not proof of triage completeness.

## Env overrides

- None required for C1. To **force** stricter behavior (e.g. require a triage row for all orchestrator bookings), that would be a product follow-up and **not** implemented here.
