# configuration — consolidated documentation

**Single file:** All former `docs/configuration/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Calendar & Availability (Tasks 1–5, 51, 52) (`CALENDAR_AVAILABILITY.md`)](#calendar-availability)
- [Visit Charge Timing (Task 21) (`VISIT_CHARGE_TIMING.md`)](#visit-charge-timing)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="calendar-availability"></a>

## Calendar & Availability (Tasks 1–5, 51, 52)

*Former path: `docs/configuration/CALENDAR_AVAILABILITY.md`*


Configuration for single calendar, business hours, provider-level availability, timezone-aware slots, and reminders.

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `CALENDAR_SINGLE_PER_ENV` | `1` \| `0` | `1` | Use single calendar per environment; ignore per-clinic calendar IDs |
| `GOOGLE_CALENDAR_ID` | calendar ID | `primary` | Calendar ID for all clinics when `CALENDAR_SINGLE_PER_ENV=1` |
| `GOOGLE_CALENDAR_TIMEZONE` | IANA | `America/New_York` | Default timezone for calendar events |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON | (none) | Service account credentials for Google Calendar API |
| `GOOGLE_CLIENT_ID` | string | (none) | OAuth2 client ID (alternative to service account) |
| `GOOGLE_CLIENT_SECRET` | string | (none) | OAuth2 client secret |

## Task 1 & 5: Single Calendar Per Env

- `CALENDAR_SINGLE_PER_ENV=1`: One calendar for the whole environment; `clinicId` is ignored when selecting the calendar
- `CALENDAR_SINGLE_PER_ENV=0`: Per-clinic calendars allowed via `clinic.google_calendar_id` and `clinic.calendar_user_email`

## Task 2: Weak Availability Without Google Creds

When Google Calendar credentials are not configured:

- Availability is derived only from DB appointments (no external events)
- `getAvailableSlots` returns `calendar_configured: false` and `calendar_warning` with double-booking guidance
- External events are not considered; there is double-booking risk if providers use other calendars

## Task 3: Business Hours & Per-Clinic Config

Configured per clinic in `clinics`:

- `business_hours_start`, `business_hours_end` (default 9, 19)
- `timezone` (e.g. `America/New_York`)
- `business_days` (JSON array: 0=Sun, 1=Mon, …, 6=Sat; default `[1,2,3,4,5]`)
- `holidays` (JSON array of `YYYY-MM-DD`)

Config module: `middleware-platform/config/clinic-business-hours.js`

## Task 4: Provider-Level Availability

- `getAvailableSlots(..., practitionerId)` filters by `practitioner_id`
- `practitioner_id` is optional on appointments and on `get_available_slots` / `schedule_appointment`
- API: `POST /voice/appointments/available-slots` and `GET/POST /api/appointments/available-slots` accept `practitioner_id`

## Task 51: Timezone-Aware Slots

- Each slot includes `slot_start_iso`, `slot_display`, and `timezone`
- `slots_with_display` provides human-readable times in the clinic timezone
- Appointments store `timezone` (via migration 004)

## Task 52: Appointment Reminders

Reminder scheduler (`middleware-platform/services/reminder-scheduler.js`):

- 24h before: email and optional SMS
- 1h before: email and optional SMS

Columns: `reminder_sent` (1h), `reminder_24h_sent` (24h)


---

<a id="visit-charge-timing"></a>

## Visit Charge Timing (Task 21)

*Former path: `docs/configuration/VISIT_CHARGE_TIMING.md`*


Configuration for when the main visit charge occurs and how deposit holds work.

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `VISIT_CHARGE_TIMING` | `pre_auth` \| `post_capture` \| `session_end` | `post_capture` | When the visit charge is taken |
| `DEPOSIT_HOLD_ENABLED` | `1` \| `true` \| (empty) | off | Use Stripe `capture_method: 'manual'` for appointment payments |

## `VISIT_CHARGE_TIMING`

- **`pre_auth`** – Authorize at booking; capture on session start (or no-show fee)
- **`post_capture`** – Charge immediately when payment completes (default)
- **`session_end`** – Charge only after SOAP sign-off / visit completion

## `DEPOSIT_HOLD_ENABLED`

When set to `1` or `true`, Stripe Payment Intents for appointment checkouts use `capture_method: 'manual'`:

- Card is authorized (hold) at booking
- Amount is captured via `POST /api/payment/capture` when the visit starts, or cancelled via `POST /api/payment/cancel` for no-shows

## Interaction with Ledger

- **`post_capture`** – Ledger entries are settled immediately after payment
- **`pre_auth` / `DEPOSIT_HOLD_ENABLED`** – Ledger entries start as `pending` until capture

## Location

- Config module: `middleware-platform/config/visit-charge-timing.js`
- Referenced by: `/process-payment` (Stripe capture_method), ledger status


