# Patient Journey Test Cases

**Last Updated:** April 9, 2026

Multiple E2E test cases representing different patients, chief complaints, and specialties.

## Usage

```bash
# Run all 8 test cases
bash scripts/run-patient-tests.sh

# Run specific cases
bash scripts/run-patient-tests.sh back_pain rash routine_visit

# Run with explicit portal session
bash scripts/run-patient-tests.sh <PORTAL_SESSION_UUID> back_pain
```

## Test Cases

| Case ID | Patient | Chief Complaint | Expected Specialty |
|---------|---------|-----------------|--------------------|
| `back_pain` | John Doe | Lower back pain (mechanical) | Orthopedics |
| `rash` | Maria Garcia | Itchy rash, may trigger photo upload | Dermatology |
| `chest_discomfort` | Robert Chen | Mild chest tightness with exertion | Cardiology |
| `routine_visit` | Sarah Johnson | Annual physical, no symptoms | Primary Care |
| `headache` | David Kim | Recurring tension headaches | Primary Care |
| `knee_pain` | Emily Watson | Knee pain post-running injury | Orthopedics |
| `vague_symptoms` | Alex Turner | Vague "feel off", tired | Primary Care (low-confidence triage) |
| `spanish` | Carlos Mendez | Lower back pain (Spanish) | Orthopedics |

## Requirements

- Server running on `PORT` (default 4000)
- Valid `patient_portal_sessions` row in DB
- `jq`, `sqlite3`, `curl`
- For rash case: dummy image at `uploads/patients/844a236e-bb91-4477-9b5d-ab6d24d92c15.png`

## Environment

- `PORT` – API port (default 4000)
- `SKIP_HEALTH_CHECK=1` – bypass server health check
- `MAX_TURNS` – max turns per case (default 18)
- `SLEEP_BETWEEN_CALLS` – seconds between API calls (default 6)
