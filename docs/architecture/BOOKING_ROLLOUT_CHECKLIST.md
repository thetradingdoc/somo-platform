# Booking Rollout Checklist

## Stage 0 - Preflight

- Confirm provider readiness endpoint returns expected rows for target clinic.
- Confirm booking observability endpoint returns confidence percentages and alerts.
- Run provider readiness backfill script:
  - `node middleware-platform/scripts/backfill-provider-calendar-readiness.js`

## Stage 1 - Safe Enablement

- Enable `PREFER_SYNCED_PROVIDERS=true`.
- Keep `CALENDAR_REQUIRED_FOR_SYNC=false`.
- Keep `BLOCKS_ONLY_ALLOWED=true`.
- Monitor `% slots high/medium/low confidence` and `% blocks-only bookings`.

## Stage 2 - Stability Validation

- Verify no-bookable-provider failures by clinic stay below threshold.
- Verify fallback copy appears in Kelly for:
  - no online specialist
  - blocks not configured
  - calendar not connected
- Verify provider settings shows readiness badges and CTAs.

## Stage 3 - Enforcement Decision

- If high-confidence ratio is stable and no-bookable failures are low:
  - decide whether to enforce `CALENDAR_REQUIRED_FOR_SYNC=true`
- If blocks-only drift alert triggers:
  - keep blocks fallback enabled
  - prioritize calendar reconnection for affected specialists

## Stage 4 - Regression Gate

- Run `calendar-booking-policy.test.js`.
- Run identity + checkout regression suite.
- Perform one inbound call and one chat booking end-to-end with payment verify.
