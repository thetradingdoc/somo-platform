# Impact Methodology and Limitations

## What the public dashboard shows

- Delayed aggregate totals of **verified** impact events.
- Endpoint: `GET /api/public/impact/dashboard`

## Privacy safeguards

- Delay window (default 24h): `IMPACT_DASHBOARD_DELAY_HOURS`
- Minimum aggregate threshold (default 5): `IMPACT_DASHBOARD_MIN_AGGREGATE`
- Only events with `privacy_classification=public_aggregate` are included.

## Limitations

- Pending events are excluded.
- False-positive rate depends on sampling volume and reviewer quality.
- Some partner feeds may arrive late and be reflected after delay windows.

## Update cadence

- Dashboard refreshes with API calls.
- Verification sampling monitored over 30-day windows.

