# PHI-Safe Messaging Rule (Telemedicine Phase 1 — Task 11)

**Rule:** No health data in any SMS or email **body**. Apply to all reminder and notification templates (upload link, booking confirmation, T-24h, T-1h, case report ready, upload confirmation).

---

## Allowed in message body

- Appointment **date and time**
- **Join** link (video)
- **Upload** link (portal URL)
- **Portal** link (e.g. view report)
- Generic phrasing: "Your appointment", "Your documents have been received", "Case report ready"

---

## Never in message body

- Patient name together with diagnosis, condition, or symptom
- Lab values, test results, or findings
- Diagnosis or condition names
- Medication names or dosages
- Any PHI that could identify the individual’s health status

---

## Templates to review

When implementing telemedicine reminders and notifications, ensure each template passes the checklist:

| Template | Location / trigger | Checklist |
|----------|--------------------|-----------|
| Upload link email | Phase 3 – send-upload-link | No PHI in subject/body |
| Upload confirmation email | Phase 4 – after first upload | No filenames, no health data |
| Booking confirmation | Phase 5 – on appointment create | Time + upload link only |
| T-24h reminder | Phase 5 – cron | Time + upload link only |
| T-1h reminder | Phase 5 – cron | Time + join link only |
| Case report ready (email) | Phase 9 – callback | "Case report ready" + portal link only |
| Case report ready (SMS) | Phase 9 – callback | Date + portal link only |

Use the validation helper in code when rendering templates: `require('../utils/phi-safe-messaging').validatePhiSafeMessage(body)`.
