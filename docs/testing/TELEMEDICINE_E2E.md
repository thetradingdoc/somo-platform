## Telemedicine E2E Test Plan

This document defines the concrete checks to verify the telemedicine case-report feature in staging/production.

Assumptions:
- BAAs are in place for Azure, Twilio, OpenAI, and Pinecone.
- Env vars are set:
  - `REQUIRE_JWT_FOR_FHIR=1` and a strong `JWT_SECRET`
  - `CASE_REPORT_SERVICE_URL`, `CASE_REPORT_SERVICE_TOKEN`
  - Case-report service: `CASE_REPORT_VALIDATE_STRICT=1` with real `OPENAI_API_KEY`, `PINECONE_API_KEY`, `MIDDLEWARE_URL`, `MIDDLEWARE_TOKEN`
    - or `CASE_REPORT_VALIDATE_STRICT=0` for stub mode (weaker AI behaviour).

---

### Test 1 — Full flow with uploads

Goal: Book → upload → video consult → `end_session` → case report → DiagnosticReport.

1. **Book an appointment**
   - Use existing booking flow (dashboard or voice agent) to create a video appointment with a test patient.
   - Note `appointment_id`, `patient_id`, and scheduled time.

2. **Send upload link**
   - Trigger the upload link via:
     - Voice agent tool (`send_document_upload_link`), or
     - `POST /api/patient/send-upload-link` with `{ patient_id, appointment_id }`.
   - Confirm email is sent (no PHI, contains `https://.../upload?token=...`).

3. **Upload labs/images**
   - Open the `/upload?token=...` URL in a browser.
   - Upload at least:
     - 1 PDF lab result.
     - 1 image (JPEG/PNG/HEIC).
   - Confirm:
     - UI shows “Your documents have been received”.
     - `patient_uploads` row(s) exist for `patient_id`/`appointment_id` with expected `mime_type` and `size_bytes`.

4. **Run the video consult**
   - Start a LiveKit session using a room named `appt-{appointment_id}`.
   - Conduct a brief consult (enough transcript to be non-empty).
   - End the session so that `POST /api/video-consult/agent-events` receives `event='end_session'` for that room.

5. **Verify appointment completion**
   - Query DB (`appointments` table) or admin UI:
     - `status` for this `appointment_id` should be `completed`.

6. **Verify case-report job creation**
   - Check `fhir_diagnostic_reports` for a row with:
     - `patient_id`, `encounter_id` from the consult.
     - `job_id` not null.
     - `status` transitions from `pending` → `completed` (watch logs or DB).

7. **Verify callback and DiagnosticReport**
   - After the case report service runs:
     - `fhir_diagnostic_reports.status = 'completed'`.
     - `case_report_text` is non-empty.
     - `resource_data` contains a FHIR `DiagnosticReport` with:
       - `resourceType: "DiagnosticReport"`.
       - `subject.reference = "Patient/{patient_id}"`.
       - `encounter.reference = "Encounter/{encounter_id}"`.
   - Call `GET /api/encounters/{encounter_id}/diagnostic-report` with a **clinician JWT**:
     - Expect `200` and a FHIR DiagnosticReport body.

8. **Verify clinician notification**
   - Confirm clinician email and/or SMS indicating “Case report ready” (no PHI in subject/body).

9. **Verify uploads linkage**
   - Confirm `patient_uploads.encounter_id` is set on the uploaded files for this `appointment_id`.

---

### Test 2 — Transcript-only path (no uploads)

Goal: Ensure transcript-only guard works and produces a transcript-only DiagnosticReport.

1. **Book an appointment** (same as Test 1, but **do not** send an upload link or upload any files).

2. **Run the video consult**
   - Start LiveKit room `appt-{appointment_id}`.
   - Generate a short but non-empty transcript.
   - End the session.

3. **Verify appointment completion and job creation**
   - `appointments.status = 'completed'` for this `appointment_id`.
   - `fhir_diagnostic_reports` has a `pending` row for the new `encounter_id`.

4. **Verify case report content**
   - After callback, call:
     - `GET /api/encounters/{encounter_id}/diagnostic-report` (clinician JWT).
   - Inspect `case_report_text`:
     - Must start with `# TRANSCRIPT-ONLY REPORT`.
     - Must *not* mention labs or imaging findings (no fake values, no references to uploaded files).

5. **Verify Layer 1 guard behaviour**
   - For this encounter:
     - `patient_uploads` should have **no** rows with this `encounter_id`.
   - Confirm logs show either:
     - A transcript-only path taken, or
     - No errors from Layer 1/4.

---

### Test 3 — Auth and token issuance

1. **Clinician JWT**
   - Call `POST /api/auth/clinician-token` with valid clinician credentials.
   - Use returned `token` to:
     - Call `GET /api/encounters/{encounter_id}/diagnostic-report` — expect `200`.
     - Call with an invalid/expired token — expect `401/403`.

2. **Patient JWT**
   - Complete `/api/patient/verify/send` → `/verify/confirm` flow.
   - Call `POST /api/auth/patient-token` with `{ email, code }`.
   - Use returned `token` to:
     - Call `GET /api/patients/{patient_id}/my-records` — expect `200` and only this patient’s reports.
     - Call `GET /api/patients/{other_patient_id}/my-records` — expect `403`.

3. **Case-report service auth**
   - With wrong `CASE_REPORT_SERVICE_TOKEN`:
     - `POST {CASE_REPORT_SERVICE_URL}/report` should return `401`.
   - With correct token:
     - The request is accepted and returns `202 { job_id, status: "queued" }`.

---

### Test 4 — Reminder scheduler sanity

1. Create a few test appointments:
   - One ~24h in the future (with email).
   - One ~1h in the future (with email).

2. Confirm:
   - Reminder scheduler logs show each appointment once in the respective window.
   - `reminder_24h_sent` and `reminder_sent` flags flip to 1 after emails go out.
   - No full-table scans in DB logs (queries should be index-backed).

