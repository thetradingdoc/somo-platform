# Voice Agent Flow Test

## Overview

The `tests/test-voice-agent-flow.js` script simulates a realistic Twilio → Retell function pipeline, including:

- Mock Twilio webhook (POST `/voice/incoming`)
- Multilingual patient scheduling via `handleScheduleAppointment`
- Insurance collection
- Appointment checkout creation

The test instantiates the `RetellWebSocketHandler`, seeds a mock call connection, and drives the same HTTP endpoints the live Retell agent uses. This catches regressions across scheduling, insurance, and payment flows without requiring a live call.

## Running the Test

```bash
cd middleware-platform
node tests/test-voice-agent-flow.js
```

Requirements:

- API server running locally (default `http://localhost:4000`)
- Optional env overrides:
  - `TEST_CLINIC_ID` (default `test-voice-flow-clinic`)
  - `TEST_CLINIC_PHONE` (default `+15551112222`)

## Expected Output

- Confirms the test clinic exists (auto-created if missing)
- Twilio webhook responds with valid TwiML
- Appointment scheduled for a Spanish-speaking patient
- Insurance collection succeeds
- Checkout is created and linked to the appointment

Any failure exits with code `1` so CI can catch regressions immediately.

