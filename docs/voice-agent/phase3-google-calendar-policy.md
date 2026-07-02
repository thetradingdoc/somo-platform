# Phase 3 — Google Calendar vs PMS

## When `pms_type = somo` (Phase 3A pilot)

- **System of record:** Somo `appointments` table via `somo-adapter` → `BookingService`
- **Google Calendar:** Optional mirror for free/busy and event write-back
- **Setup:** Settings → PMS → "Use Somo calendar" + Settings → Google Calendar connect

`CALENDAR_SINGLE_PER_ENV=1` (default) uses one env-wide calendar ID unless per-clinic config is enabled.

## When `pms_type = athena | dentrix | eaglesoft` (Phase 3B)

- **System of record:** External PMS APIs
- **Google Calendar:** Skip mirror writes when external PMS books (adapter is SSOT)
- **Requires:** Vendor API credentials per tenant

## Kelly scheduling

All paths use `services/pms/pms-booking.js` → `PmsHub` → adapter.
