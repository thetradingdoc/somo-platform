# Runbook — Reconciliation drift / SLA breaches

## Symptoms

- `GET /api/admin/payment-ops/alerts` includes `reconciliation_sla_breaches`
- `GET /api/rcm/reconciliation/exceptions?status=open` shows exceptions older than SLA

## Immediate actions

1. Identify the top classifications and event keys in the exception queue.
2. Confirm ingestion is flowing:
   - Stripe PI: `payment_intent.succeeded` processor rows exist
   - Refunds/disputes: webhook events exist and canonical rows exist
3. Run a manual reconciliation window if needed:
   - `POST /api/rcm/reconciliation/run` with a narrow window

## Common causes

- Webhook ingestion disabled: `FINANCIAL_INTEGRITY_WEBHOOK_INGESTION=0`
- Processor event gaps (Stripe/Circle outage or misconfiguration)
- Internal event keys mismatched vs processor keys

## Recovery

- Fix ingestion first (webhook config, env flags).
- Re-run reconciliation after ingestion is healthy.
- Assign owners for open exceptions and document resolution notes.

## Escalation

- If drift spans multiple days or deltas are large: escalate to finance + engineering on-call.

