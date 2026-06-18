# Google Calendar sync — double-book prevention (CR-050)

**Last updated:** 2026-06-17

## Behavior

When a provider connects Google Calendar in **Settings → Calendar**, Somo:

1. Pulls busy blocks from the linked calendar before offering slots via `get_available_slots`.
2. Writes voice-booked appointments back to Google Calendar on `schedule_appointment` success.
3. Rejects in-portal manual bookings that overlap an existing Somo or Google busy block (409 from booking API).

## E2E verification (staging)

```bash
# Requires GOOGLE_CALENDAR_TEST_ACCOUNT + linked clinic in staging DB
cd middleware-platform
npm run test:e2e:google-calendar-sync
```

Manual smoke:

1. Connect Google Calendar on `settings.html` → Calendar tab.
2. Block 2–3pm on Google Calendar directly.
3. Call Kelly and request 2pm — expect `slots_empty` or alternate time offer, not a confirmed 2pm booking.
4. Book 10am via Kelly — confirm event appears on Google within 60s.

## Failure modes

| Symptom | Check |
|---------|-------|
| Double book | `calendar_sync_tokens` last_sync_at; webhook refresh |
| Kelly offers busy slot | `get_available_slots` admission gate + Google freebusy cache TTL |
| Portal book succeeds on busy | `BookingService` conflict check logs |

See also [`docs/deployment/OPERATIONS.md`](../deployment/OPERATIONS.md) Kelly rails section.
