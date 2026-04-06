# Voice triage parity (Kelly vs Retell direct)

Linked from **`docs/architecture/BOOKING_CHECKOUT_ARCHITECTURE_ANALYSIS.md`** §3 (Gates legend and booking tools table).

## Intent

- **Kelly path** (`KellyToolExecutor`) always sends `session_id` / `metadata.session_id` on `/voice/appointments/schedule` and `/voice/appointments/available-slots`.
- **Retell direct** (`function_call` → `handleScheduleAppointment`, etc.) must send the same so `server.js` can apply **one** set of DB triage guardrails.

## Defense-in-depth

1. **`checkBeforeScheduling`** in `retell-websocket.js` — conversation-based emergency block (red flags in recent turns). Runs **before** the HTTP call.
2. **`enforceVoiceTriageGuardrailsForSession`** in `server.js` — `triage_sessions` + RAG confidence + OPQRST + `intake_complete_at` when `session_id` / `call_id` is present.

Both are **intentional**. Do not remove (1) without product sign-off; it catches emergencies before a triage row exists.

## Environment

| Variable | Effect |
|----------|--------|
| `REQUIRE_TRIAGE_FOR_VOICE=1` | `POST /voice/appointments/schedule`, `/voice/appointments/available-slots`, `/voice/appointments/reschedule`, and **`POST /voice/insurance/collect`** return **400** `SESSION_ID_REQUIRED` if neither `session_id` nor `call_id` is in the body. |
| `LEGACY_APPOINTMENTS_API_DISABLED=1` | Legacy **`/api/appointments/schedule`**, **`available-slots`**, **`reschedule`** return **410** — use patient portal + `/voice/...` instead. |

## Operations (C6)

- **Production voice:** set **`REQUIRE_TRIAGE_FOR_VOICE=1`** unless you have a documented reason to allow anonymous `/voice/...` calls without a triage session id.
- **Slot cache:** keys include an **`rtfv0` / `rtfv1`** segment so toggling `REQUIRE_TRIAGE_FOR_VOICE` does not reuse stale **`no_session`** cache rows (C10).
- **Tests:** `npm test` in `middleware-platform` runs **`checkBeforeScheduling`** defense-in-depth tests and **reschedule vs schedule gate** source checks (C11/C12).

## Field contracts (V1/V2/V3)

- **V1 checkout payload contract:** callers should send both families for compatibility:
  - `customer_name`, `customer_email`, `customer_phone`
  - `patient_name`, `patient_email`, `patient_phone`
  - Server normalizes with `customer_* || patient_*`.
- **V2 slot bundles:** slot responses should include `slot_bundles` with `practitioner_id` when available; fallback paths synthesize bundles so downstream scheduling can resolve deterministic slot selections.
- **V3 clinic_id resolution priority:** `resolveClinicIdFromRequest` uses:
  1. explicit request values (`args.clinic_id`, header `x-clinic-id`, query/body clinic_id),
  2. phone mapping (`From` / `patient_phone` -> `clinic_phone_numbers`),
  3. env fallback (`DEFAULT_CLINIC_ID` / `PRIMARY_CLINIC_ID`).

## Manual test matrix

| # | Case | Expected |
|---|------|----------|
| 1 | `POST /voice/appointments/schedule` with `session_id` set, triage incomplete | **403** `TRIAGE_INCOMPLETE` |
| 2 | Same, triage complete per DB | **200** (or business validation errors) |
| 3 | `session_id` set, **no** `triage_sessions` row yet (e.g. first `function_call`) | **403** `TRIAGE_INCOMPLETE` |
| 4 | Kelly `schedule_appointment` via tool (existing harness) | **200** after triage — regression |
| 5 | `POST /voice/appointments/available-slots` with `session_id` + incomplete triage | **403** (same gates as schedule) |
| 6 | `REQUIRE_TRIAGE_FOR_VOICE=1`, body without `session_id`/`call_id` | **400** `SESSION_ID_REQUIRED` |

Use `scripts/test-voice-triage-parity-smoke.sh` with the server running (optional).

## Files

- `services/voice-triage-guards.js` — **`resolveVoiceSessionIdForGuard`**, **`requireVoiceSessionIdForTriageParity`**, **`evaluateTriageGuardrailsForSession`** (pure — Patient Orchestrator when a triage row exists), **`enforceVoiceTriageGuardrailsForSession`** (Express; `server.js` imports via `require`)
- `webhooks/retell-websocket.js` — `handleScheduleAppointment`, `handleGetAvailableSlots`, `handleRescheduleAppointment`
- `server.js` — route wiring for `/voice/appointments/*`, `/voice/insurance/collect`
