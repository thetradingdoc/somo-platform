## Telemedicine – Production Readiness Tasks

This section tracks the open gaps from the architecture review. Each item has a priority and a concrete action.

---

### P0 — Appointment completion (case report trigger)

- **Status (May 2026):** **Implemented** — `BookingService.completeAppointment` in `services/booking-service.js`; `routes/video-consult.js` calls it on `end_session` before `videoConsultGraph.processEvent`.
- **Verify:** `SKIP_STARTUP_MIGRATIONS=1 npx jest __tests__/booking-complete-appointment.test.js`
- **Remaining:** E2E smoke book → video → case report; runbook BAAs (P3).

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

## Production-Grade Plumbing (9-Step Architecture)

From `docs/architecture/patients/PATIENT_VOICE_BOOKING_ARCHITECTURE.md` — technical links between steps.

### P2 — Case ID Handshake (Step 2 ↔ Step 7)

- **Gap**: When the doctor enters the LiveKit room, they must see the Case Report (Step 2) immediately without searching.
- **Action**:
  - Set `room_name = case_id` (e.g. `case-CR-2026-001234`) or ensure `appt-{id}` resolves to a case.
  - Provider video-call page: on room join, fetch `GET /api/provider/case-report?room={room_name}` and render in a side-panel.
  - Room naming: prefer `case-{case_number}` for direct lookup, or map `appt-{id}` → `case_id` via appointment.

---

### P2 — Pre-Auth vs Capture (Step 5, Step 8)

- **Gap**: In Sync (Video) model, if the doctor doesn't show up, refunding a captured payment incurs processing fees.
- **Action**:
  - Use Stripe **Authorize Now, Capture Later**.
  - **At Booking (Step 5)**: Hold funds (pre-auth), do not capture.
  - **At Step 8 (Report Generation)**: When the doctor submits the final report, capture the payment.

---

### P2 — Async-to-Sync Escalation (Step 3)

- **Gap**: Patient pays for Async Review; specialist determines "needs live consultation."
- **Action**:
  - Add "Requires Live Consultation" button in provider async-queue UI.
  - System sends patient a **Delta Payment** link (price difference Async → Sync).
  - Once paid, convert case to Sync and enter Step 4a (video booking flow).

---

### P3 — Ambient AI Real-Time Pipeline (Step 7)

- **Gap**: Ambient AI must draft reports during the call, not after hang-up.
- **Action**:
  - Use LiveKit **Egress** or **Transcription** to pipe audio → transcript feed → draft report service.
  - Ensure report is ready seconds after hang-up.

---

### P3 — Multi-Tenant Voice (Step 12)

- **Gap**: Need region-aware voice, pricing, and timezone handling.
- **Actions**:
  1. **Inbound Number → Price Tier**: Map `Inbound_Number` to `Price_Tier` via `clinic_phone_numbers` / `phone-country-map.js`. +263 → Tier 4, +1 → Tier 1.
  2. **Agent Configured Numbers**: Voice agent must know and refer to configured inbound numbers in prompts.
  3. **Region Check**: In region → offer Voice + Video. Outside region → Video (web) only.
  4. **Timezone Awareness**: Agent aware of patient vs provider timezone for "immediate" vs "scheduled"; display slots in patient timezone.

---

### Runbook items (no code changes, required before PHI in production)

- Ensure Azure, Twilio, OpenAI, and Pinecone BAAs are signed and documented.
- Verify Azure Blob encryption at rest (AES-256) and 7-year retention policy for `patient-uploads`.
- Confirm SAS token generation in middleware enforces a max 1-hour expiry.
- Run a full smoke test: book → upload → video consult → end_session → case report callback → GET DiagnosticReport.

