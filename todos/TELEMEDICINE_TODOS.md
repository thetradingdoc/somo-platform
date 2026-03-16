## Telemedicine – Production Readiness Tasks

This section tracks the open gaps from the architecture review. Each item has a priority and a concrete action.

---

### P0 — Appointment completion (case report trigger)

- **Gap**: Case reports never run because `trigger_case_report` only fires when `appointment.status === 'completed'`, and no code sets that status on video `end_session`.
- **Action**:
  - Implement `BookingService.completeAppointment(appointmentId, clinicId)` (wrapper around `db.updateAppointmentStatus(…, 'completed', …)`).
  - In `routes/video-consult.js`, when `event === 'end_session'` and `room` is `appt-{id}`, call `BookingService.completeAppointment(appointmentId)` **before** calling `videoConsultGraph.processEvent(...)`.

---

### P1 — Enforce JWT for FHIR/DiagnosticReport in production

- **Gap**: `jwtFhirAuth` is opt-in via `REQUIRE_JWT_FOR_FHIR`; production could accidentally run with all FHIR and DiagnosticReport endpoints open.
- **Action**:
  - Add a startup guard in `server.js` that, in production, refuses to start unless `REQUIRE_JWT_FOR_FHIR=1` and a strong `JWT_SECRET` are set.
  - Ensure env vars are set in production.

---

### P1 — JWT issuer endpoints (patient / clinician)

- **Gap**: There is no endpoint that issues JWTs, so patients and clinicians cannot actually call the protected DiagnosticReport APIs.
- **Action**:
  - Add `POST /api/auth/patient-token` (after email/OTP verification) that issues a JWT with `sub=patient_id`, `scope='patient'`.
  - Add `POST /api/auth/clinician-token` (after existing admin/clinician login) that issues a JWT with `sub=user_id`, `scope='clinician'`, `clinic_id`.

---

### P2 — session_metadata.appointment_id on video consult

- **Gap**: LangGraph `trigger_case_report` falls back to parsing `room_id` for `appt-{id}`; `session_metadata.appointment_id` is never set explicitly.
- **Action**:
  - In `routes/video-consult.js`, when constructing `options` for `videoConsultGraph.processEvent`, set `options.session_metadata.appointment_id = appointmentId` when the room is `appt-{id}`.

---

### P2 — Case report service strict config vs. stub mode

- **Gap**: `validate_config()` requires OpenAI, Pinecone, middleware URL/token, etc. There is no way to run the service in a minimal or “stub” mode without all AI backends.
- **Action**:
  - Add an env flag (e.g. `CASE_REPORT_VALIDATE_STRICT=0`) that, when disabled, logs warnings for missing AI keys instead of raising, while still requiring security-critical values (CASE_REPORT_SERVICE_TOKEN, storage backend).

---

### P2 — Case report service auth (inbound POST /report)

- **Gap**: The FastAPI `/report` endpoint does not validate any Bearer token; any caller can enqueue jobs.
- **Action**:
  - In `app/main.py`, require `Authorization: Bearer {CASE_REPORT_SERVICE_TOKEN}` on `POST /report` and return 401 otherwise.

---

### P2 — Internal transcript endpoint for case report service

- **Gap**: The case report service expects an internal endpoint like `GET /internal/communications/:encounterId/text`; this does not yet exist.
- **Action**:
  - Add an internal route that:
    - Validates `CASE_REPORT_SERVICE_TOKEN` (Bearer).
    - Reads all Communications for the given encounter from FHIR/DB.
    - Reassembles them into a plain-text transcript and returns `{ encounter_id, text }`.
    - Writes an `audit_log` entry for transcript access.

---

### P2 — Case report pipeline Layer 1 (non-stub)

- **Gap**: `_layer1_perception` is a stub; it never populates `signal_analysis`, so the transcript-only guard always fires even when files are present.
- **Action**:
  - In the Python case-report service repo, implement Layer 1 to:
    - Extract text from PDF labs (e.g. via `pdfplumber`) and normalise into `signal_analysis`.
    - Register presence of images (JPEG/PNG/HEIC) in `visual_findings`.
  - Ensure `signal_analysis` is non-empty when uploads exist so the guard can distinguish transcript-only vs full inputs.

---

### P3 — E2E test for transcript-only path

- **Gap**: No automated end-to-end test verifies the “no uploads” path that should produce a `TRANSCRIPT-ONLY REPORT`.
- **Action**:
  - Add a smoke/e2e test that:
    - Books an appointment.
    - Skips uploads.
    - Runs a short video consult and `end_session`.
    - Asserts that:
      - One DiagnosticReport is created.
      - The report text begins with `# TRANSCRIPT-ONLY REPORT`.

---

### P3 — Double-trigger guard for trigger_case_report

- **Gap**: If `end_session` arrives twice for the same room/encounter, two case report jobs can be enqueued.
- **Action**:
  - In `triggerCaseReportNode`, check for an existing pending/complete case report row for that `encounter_id` before inserting a new one; skip enqueueing if one already exists.

---

### P3 — Reminder scheduler query window

- **Gap**: Reminder scheduler currently scans all appointments on every run; this does not scale.
- **Action**:
  - Change the scheduler to query only appointments within a limited time window (e.g. 24–25h and 55–65 minutes from now).
  - Add an index on `(start_time, status, reminder_sent)` to support the query.

---

### P3 — patient_uploads.encounter_id backfill

- **Gap**: Uploaded documents are not linked to the encounter in `patient_uploads`, only to `appointment_id`.
- **Action**:
  - After a video consult ends and `encounter_id` is known, update `patient_uploads` rows for that appointment where `encounter_id IS NULL` to set the correct encounter_id.

---

### Runbook items (no code changes, required before PHI in production)

- Ensure Azure, Twilio, OpenAI, and Pinecone BAAs are signed and documented.
- Verify Azure Blob encryption at rest (AES-256) and 7-year retention policy for `patient-uploads`.
- Confirm SAS token generation in middleware enforces a max 1-hour expiry.
- Run a full smoke test: book → upload → video consult → end_session → case report callback → GET DiagnosticReport.

