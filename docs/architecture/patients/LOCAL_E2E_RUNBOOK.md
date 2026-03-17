## Local E2E Runbook – Patient Journey

This runbook describes how to exercise the full patient journey locally, from voice intake through payment, video visit, and case report.

### 1. Start middleware

- Ensure `.env` is configured (see `PATIENT_WEB_PORTAL_TODO.md` section 0).
- From the repo root:

```bash
cd middleware-platform
DB_PATH=./middleware-dev.db npm start
```

The API should be available at `http://localhost:4000`.

### 2. Create a voice-driven appointment + checkout

- Either:
  - Run your Retell/Twilio voice flow against the local middleware (preferred), or
  - Use an existing helper/script that simulates a voice checkout, ensuring it creates:
    - A `voice_checkouts` row with `appointment_id` populated.
    - An `appointments` row for the patient.
- Confirm in the DB (SQLite) that:
  - `appointments` has a new row.
  - `voice_checkouts` has a row linked to that appointment and a `payment_token` (if payment-on-web is expected).

### 3. Receive/log the login + payment links

- The middleware sends email via `EmailService`. For local dev:
  - Emails are typically logged to the console (check `npm start` output).
  - Capture:
    - Patient login link (email + 6-digit code).
    - Any payment link (`/payment/{token}`) if present.

### 4. Patient login → onboarding

- Open the unified dashboard in a browser:

```text
http://localhost:4000/unified-dashboard/patients/patient-login.html
```

- Enter the same email used in the voice flow and the 6-digit code from logs.
- After verification:
  - If `FEATURE_PATIENT_ONBOARDING` is enabled (default), you should be redirected to `onboarding.html` on first login.
  - Complete:
    - Step 1: Confirm profile details and save.
    - Step 2: Confirm insurance details and save (optionally triggers eligibility).
    - Step 3: Upload at least one document.

### 5. Appointments + payment

- Navigate to:

```text
/unified-dashboard/patients/appointments.html
```

- Verify:
  - The appointment created by the voice flow appears.
  - If payment is still pending:
    - A “Pay now” action or link is available, using the payment token.
- Complete payment via the hosted payment page:
  - Follow the link from the email or from `appointments.html`.
  - On success:
    - `voice_checkouts.status` should become `completed`.
    - `appointments.payment_status` should become `paid`.
    - `appointments.status` should become `confirmed`.

### 6. Join and complete the video visit

- From `appointments.html`, click “Join video” for the confirmed appointment.
  - This opens `video-call.html` with the appropriate room.
- Conduct a short test session, then end the call:
  - The backend `POST /api/patient/appointments/:id/complete` (or video callback) should:
    - Mark the appointment `completed`.
    - Trigger `BookingService.completeAppointment`, which in turn:
      - Updates status.
      - Calls `FHIRService.createDiagnosticReportForAppointment` to create a FHIR `DiagnosticReport`.

### 7. View documents and case report

- Documents:
  - Go to `/unified-dashboard/patients/my-records.html`.
  - Confirm:
    - Uploaded documents from onboarding appear in the “Uploaded documents” section.

- Case report (if `FEATURE_PATIENT_CASE_REPORT` is enabled):
  - From the provider/business side, open:

  ```text
  /unified-dashboard/business/patient-case.html?patientId={FHIR_PATIENT_ID}
  ```

  - You can obtain `{FHIR_PATIENT_ID}` via:
    - Logs when the patient is created, or
    - A quick DB query against `fhir_patients`.
  - Verify that:
    - Encounters, appointments, claims/eligibility (if any), financials, documents, and DiagnosticReports are visible in the longitudinal timeline.

