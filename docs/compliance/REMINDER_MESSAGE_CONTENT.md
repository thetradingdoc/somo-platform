# Reminder message content review (Telemedicine Phase 5 — Task 38)

**Purpose:** Ensure no PHI or health data appears in any SMS or email reminder body.

## Rules (verify for every reminder channel)

- **No** patient name combined with health condition, diagnosis, or clinical detail.
- **No** lab values, results, or test data.
- **No** diagnosis or treatment details.
- **No** health data of any kind in the message body.

## What is allowed

- Appointment **date/time** (generic “your appointment”, “appointment tomorrow at [time]”).
- **Links** only: upload portal link, join/video link. No PHI in URL path (token is opaque).
- Generic wording: “Reminder”, “Upload documents”, “Join here”, “Appointment confirmed”.

## Where reminders are sent

| Trigger        | Email                         | SMS (if phone present)                          |
|----------------|-------------------------------|-------------------------------------------------|
| Booking (35)   | Confirmation + upload link     | “Appointment confirmed for [time]. Upload: [link]” |
| T-24h (36)    | “Appointment tomorrow at [time]. Upload: [link]” | Same text (upload link)                    |
| T-1h (37)     | “Your appointment is in 1 hour. Join here: [link]” | Same text (join link)                     |

Implementation: `middleware-platform/services/reminder-scheduler.js`, `services/telemedicine-reminders.js`, `services/email-service.js` (sendAppointmentConfirmation, sendAppointmentReminder24h, sendAppointmentReminder). Patient name may appear in email salutation (“Dear [name]”) only; no health data in body.

## Review checklist (Task 38)

- [ ] No patient name + health condition in same message.
- [ ] No lab values in any SMS or email.
- [ ] No diagnosis in any SMS or email.
- [ ] No health data in any SMS or email body.
