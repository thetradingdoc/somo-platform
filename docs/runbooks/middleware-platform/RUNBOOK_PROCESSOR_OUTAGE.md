# Runbook — Payment processor outage (Stripe/Circle)

## Symptoms

- Elevated `payment_process_failed` and/or checkout errors
- Stripe API errors (timeouts, 5xx) in logs
- Circle transfer failures / settlement retries spiking

## Immediate actions

1. Confirm current provider status in vendor dashboards (Stripe / Circle status pages).
2. Reduce blast radius:
   - Pause non-critical flows if needed (feature flags / traffic shaping).
3. Communicate internally:
   - Open an incident (see `INCIDENT_RESPONSE.md`).

## Customer handling

- Avoid double charges: confirm PI/transfer status before retries.
- For refunds/disputes: record workflow ids and avoid manual ad-hoc actions.

## Recovery

- Resume normal operation after vendor stability returns.
- Re-run reconciliation for outage window.
- Review settlement DLQ: `GET /api/admin/payment-ops/settlement/dead-letter`.

