# Telemedicine Architecture Review

**Date:** 2025-03  
**Scope:** End-to-end flow (voice → upload → reminders → video consult → case report → DiagnosticReport), auth, and production readiness.

---

## 1. What’s in good shape

- **Flow is coherent:** Voice (Retell) → send_upload_link; reminders (24h/1h + booking) with upload/join links; upload portal token-based; video (LiveKit) → LangGraph → store_fhir → trigger_case_report; case report service → callback → FHIR DiagnosticReport + clinician notify.
- **Repo split:** Middleware owns triggers and callback; case report service is separate (Phase 6) with clear contract (POST /report, GET /internal/communications/:id/text, POST callback with Bearer).
- **Data layer:** patient_uploads, upload_tokens, fhir_diagnostic_reports, reminder columns (D4: reminder_sent for 1h) and migrations are in place.
- **Compliance hooks:** audit_log on FHIR and case report; PHI-safe messaging docs; JWT + resource-access middleware implemented and wired on FHIR router.
- **Case report hardening:** Storage filename collision fixed; Azure fallback removed; validate_config() and Bearer callback auth in place.
- **Timeout/retry:** Case report timeout worker (10 min → mark failed; retry once after 5 min) is started with ReminderScheduler.
- **DiagnosticReport APIs:** GET by encounter, list by patient (clinician), my-records (patient) under /api with jwtFhirAuth.

---

## 2. Critical gap: Case report never triggers (appointment never “completed”)

**Issue:** `triggerCaseReportNode` only runs the trigger when `appointment.status === 'completed'`. Nothing in the codebase sets an appointment to `completed` when a video consult ends.

- Decision D2 (TELEMEDICINE_TODOS): *“Middleware sets it when processing end_session: … call BookingService.completeAppointment(appointment_id).”*
- **Current behaviour:** On `end_session`, the graph runs store_fhir → trigger_case_report. The trigger reads the appointment; status is still `scheduled` or `confirmed`, so it returns `{}` and **never** POSTs to the case report service.
- **Effect:** No case reports are ever triggered for video consults.

**Fix:**

1. **Implement** `BookingService.completeAppointment(appointment_id)` (e.g. calls `db.updateAppointmentStatus(appointment_id, 'completed', null, clinicId)`).
2. **Call it on end_session** before running the graph (or immediately after store_fhir), when the room is appointment-linked:
   - In `routes/video-consult.js`, when `event === 'end_session'` and `room.startsWith('appt-')`, resolve `appointment_id` and call `BookingService.completeAppointment(appointment_id)` **before** `videoConsultGraph.processEvent(...)` (so when the graph runs, the appointment is already completed).

Until this is done, the telemedicine “video consult → case report” path is non-functional.

---

## 3. Other architecture issues and gaps

### 3.1 JWT for FHIR is opt-in

- `jwtFhirAuth` only enforces JWT when `REQUIRE_JWT_FOR_FHIR=1` (or `true`) and `JWT_SECRET` is set. Otherwise it passes through.
- **Gap:** If production runs without these env vars, all FHIR endpoints (and thus DiagnosticReport APIs if they ever sit under /fhir) are unauthenticated. DiagnosticReport routes under `/api` use `jwtFhirAuth` but the same opt-in applies.
- **Recommendation:** For production, require JWT: set `REQUIRE_JWT_FOR_FHIR=1` and `JWT_SECRET`, and document that unset = dev-only.

### 3.2 DiagnosticReport routes under /api

- Mount: `app.use('/api', diagnosticReportRoutes)` → GET `/api/encounters/:id/diagnostic-report`, `/api/patients/:id/diagnostic-reports`, `/api/patients/:id/my-records`.
- These use `jwtFhirAuth` and scope checks. No extra gap beyond the global JWT opt-in above.

### 3.3 Case report service: strict validate_config()

- `validate_config()` requires OPENAI_API_KEY, PINECONE_API_KEY, MIDDLEWARE_URL, MIDDLEWARE_TOKEN, CASE_REPORT_SERVICE_TOKEN (and Azure connection string when backend is azure_blob).
- **Gap:** There is no “transcript-only” or minimal mode: if you want to run without Pinecone/OpenAI (e.g. stub pipeline), the service won’t start.
- **Recommendation:** Either keep strict for production only, or add an env flag (e.g. `CASE_REPORT_VALIDATE_STRICT=0`) to skip AI/middleware checks for local/stub runs.

### 3.4 session_metadata.appointment_id in LangGraph

- `triggerCaseReportNode` uses `state.session_metadata?.appointment_id` or falls back to `room_id.replace(/^appt-/, '')`.
- **Current:** `options.session_metadata` in the route is set with `start_time` / `end_time` but **appointment_id is not** set in session_metadata when calling the graph. So the trigger relies on the room name (`appt-{id}`). That’s fine as long as room names always follow that convention and the route doesn’t overwrite session_metadata with an object that lacks appointment_id.
- **Recommendation:** When `event === 'end_session'` (or when creating/updating session), set `options.session_metadata.appointment_id = appointmentId` when `room.startsWith('appt-')` so the graph has it explicitly.

### 3.5 Retell: appointment_id only on voice

- `appointment_id` is derived in Retell from the room name (Task 52) for voice. That’s for future use (e.g. linking voice to case report or upload link). No bug; just note it’s voice-side only; video uses room from agent-events.

### 3.6 Callback idempotency

- Callback updates by `job_id`. If the case report service retries the callback (e.g. timeout/retry), the same job_id can be updated twice. Current handler overwrites status/case_report_text; that’s idempotent. If you later add “only update if status is still pending” to avoid overwriting a completed report, document the contract.

### 3.7 Upload token: single use after first file

- Token is marked used after the first successful file upload. So one link = one batch of files (up to 10) in one go; no “come back later” with the same link. Matches “one-time use” in the spec; just ensure product expectations align.

---

## 4. Gaps that need to be solved (summary)

| Priority | Gap | Where | Action |
|----------|-----|--------|--------|
| **P0** | Appointment never set to `completed` → case report never triggered | video-consult route + booking-service | Add `BookingService.completeAppointment(appointment_id)` and call it on `end_session` before processEvent when room is `appt-*`. |
| **P1** | JWT for FHIR/DiagnosticReport is opt-in | server + env | Production: set REQUIRE_JWT_FOR_FHIR=1 and JWT_SECRET; document. |
| **P2** | session_metadata.appointment_id not set for graph | video-consult route | Set `options.session_metadata.appointment_id` when room is `appt-*` so trigger has it explicitly. |
| **P2** | Case report service won’t start without OpenAI/Pinecone | case-report-service config | Optional: allow a “minimal” or stub mode (env flag) for dev/staging without full AI stack. |
| **P3** | No automated e2e test for “transcript-only” path | testing | Phase 10 Task 63: doc exists; consider a single e2e (or smoke) that runs transcript-only and checks DiagnosticReport content. |

---

## 5. Is this production ready?

**Short answer: No.** One critical bug and several configuration/design choices must be fixed or decided first.

### Blockers for “production ready”

1. **Case report never runs (P0 above)**  
   Until `completeAppointment` is called on end_session, no case reports are generated for video consults. This is a core feature failure.

2. **Auth**  
   If production runs without `REQUIRE_JWT_FOR_FHIR=1` and `JWT_SECRET`, FHIR and DiagnosticReport APIs are open. That’s not acceptable for production PHI.

3. **BAAs and runbooks**  
   TELEMEDICINE_TODOS Phase 1: Azure/Twilio/OpenAI/Pinecone BAAs and Blob runbooks (encryption, SAS, lifecycle) are manual/runbook items. They must be done and verified before production PHI.

4. **Case report service config**  
   Service fails fast on missing env (good). Production must set all required vars (including MIDDLEWARE_URL/MIDDLEWARE_TOKEN and, if used, Azure + OpenAI + Pinecone). No “half-on” production without a defined minimal mode.

### What is ready

- End-to-end **design** and data model.
- Upload portal, reminders, timeout/retry worker, callback and DiagnosticReport APIs, audit and PHI-safe messaging hooks.
- Case report service fixes (storage, callback auth, validate_config).

### Recommended path to production

1. **Fix P0:** Implement and call `BookingService.completeAppointment(appointment_id)` on video `end_session` (room `appt-*`).
2. **Harden auth:** Set and enforce `REQUIRE_JWT_FOR_FHIR=1` and `JWT_SECRET` in production; document that unset is dev-only.
3. **Optional P2:** Set `session_metadata.appointment_id` in the video-consult route for clarity.
4. **Checklist:** Complete Phase 1 BAA/runbook items; confirm case report service env (and optional minimal mode) for target environment.
5. **Smoke test:** Run one full flow (book → upload → video consult → end_session → case report callback → GET diagnostic-report) and confirm one DiagnosticReport is created.

After P0 and auth are in place and BAAs/runbooks are done, the architecture can be considered **production-capable** for the defined telemedicine scope, with the remaining items (P2/P3) as follow-ups.
