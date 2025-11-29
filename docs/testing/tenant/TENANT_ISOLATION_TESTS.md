# Tenant Isolation Tests

## Overview

`tests/test-tenant-isolation.js` validates that the voice-agent booking stack enforces clinic scoping end-to-end.

- Books one appointment per clinic (`clinic-isolation-a`, `clinic-isolation-b`) using the same phone number.
- Verifies `db.getAppointment(id, clinic_id)` only returns data for the matching clinic.
- Confirms `BookingService.searchAppointments(phone, clinic_id)` never leaks results between tenants.
- Cleans up all generated appointments automatically.

## How to Run

```bash
cd middleware-platform
node tests/test-tenant-isolation.js
```

> The script runs entirely against the local SQLite database—no external APIs are required.

## Expected Output

- ✅ Appointment creation succeeds for both clinics.
- ✅ Cross-clinic lookups return no records.
- ✅ Search results are isolated per clinic.

If any step fails, the script exits with a non-zero status and prints the failing assertion.

