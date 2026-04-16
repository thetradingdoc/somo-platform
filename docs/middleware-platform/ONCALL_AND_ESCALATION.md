# On-call & escalation (payments / security)

This is the operational policy for incidents involving payment processing, webhooks, reconciliation, and security events.

## Roles

- **Primary on-call (Payments)**: `PAYMENT_EXCEPTION_DRI_PRIMARY` (or weekly rotation from `PAYMENT_EXCEPTION_OWNER_POOL`)
- **Backup on-call**: `PAYMENT_EXCEPTION_DRI_BACKUP`

View effective owners:
- `GET /api/admin/payment-ops/exception-owners`

## Escalation policy

- **Sev1 (critical)**: payments down, repeated webhook failures, suspected compromise, reconciliation drift with large deltas
  - Page primary + backup immediately.
  - Notify leadership + compliance if PHI/PII or fraud is suspected.
- **Sev2 (major)**: partial outage, high error rate, dispute evidence deadline risk
  - Page primary; notify backup if not mitigated in 30 minutes.
- **Sev3 (minor)**: isolated failures, small drift, routine support issues
  - Triage during business hours or next rotation.

## Communication

- Open an incident record using `INCIDENT_RESPONSE.md`.
- Status updates cadence:
  - Sev1: every 15–30 minutes
  - Sev2: hourly

