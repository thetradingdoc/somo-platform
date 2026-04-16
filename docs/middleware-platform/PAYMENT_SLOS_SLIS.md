# Payments reliability — SLOs & SLIs (Phase 0)

This defines the **service level indicators** (SLIs) and **service level objectives** (SLOs) for payment + webhook + reconciliation reliability.

## Scope

- **Payment API**: `/api/payment/*` (checkout, process, refund, cancel, capture)
- **Stripe webhook ingestion**: `/webhooks/stripe`
- **Reconciliation completion**: deterministic reconciliation job + exception queue

## SLOs (targets)

Configured via env and exposed at `GET /api/admin/payment-ops/slo`.

- **Payment API success rate (30d)**: default **99.5%**
  - Env: `PAYMENTS_API_SLO_SUCCESS_RATE_30D` (default `0.995`)
- **Stripe webhook processing success (30d)**: default **99.9%**
  - Env: `STRIPE_WEBHOOK_SLO_SUCCESS_30D` (default `0.999`)
- **Reconciliation completion**: default **≤ 6 hours**
  - Env: `RECONCILIATION_SLO_COMPLETION_HOURS` (default `6`)

## SLIs (what we measure)

### Payment API

**Signals**
- `ops_counters`: `payment_checkout_failed`, `payment_checkout_error`, `payment_process_failed`
- in-memory metrics (best-effort in current process): `payments_success_total`, `payments_record_error_total`, `payments_ledger_error_total`

**Notes**
- `ops_counters` are persisted and suitable for alerting.
- in-memory metrics are for debugging and will reset on restart.

### Stripe webhook processing

**Signal**
- `stripe_webhook_events` table rows with `status='failed'` in the last hour.

### Reconciliation completion / drift

**Signal**
- `reconciliation_exceptions` where `status='open'` and `sla_due_at < now`.

## Alerting thresholds (Phase 0 defaults)

These thresholds are evaluated by the reliability monitor and exposed at `GET /api/admin/payment-ops/alerts`.

- `ALERT_STRIPE_WEBHOOK_FAILURES_PER_HOUR` (default `5`)
- `ALERT_PAYMENT_PROCESS_FAILED_PER_HOUR` (default `10`)
- `ALERT_RECON_SLA_BREACHES` (default `1`)

## How to use

- **SLO/SLI snapshot**: `GET /api/admin/payment-ops/slo`
- **Alerts report**: `GET /api/admin/payment-ops/alerts`
- **Runbooks**: see `docs/runbooks/middleware-platform/`

