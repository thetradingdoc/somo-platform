# Calendar & Availability (Tasks 1–5, 51, 52)

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
