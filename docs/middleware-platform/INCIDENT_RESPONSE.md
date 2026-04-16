# Incident response (payments / security)

## Severity model

- **Sev1**: Payments unavailable, large-scale double-charge risk, active security compromise, critical webhook ingestion failure, or financial integrity breach.
- **Sev2**: Partial outage, significant degradation, dispute evidence at risk, reconciliation SLA breaches growing.
- **Sev3**: Localized errors, minor degradation, low-risk drift.

## Required timeline capture

Record:
- Start time, detection channel, impacted surface (payment API / webhooks / settlement / reconciliation)
- Current hypothesis and top logs/metrics
- Mitigations attempted + results
- Final root cause + follow-ups

## Standard process

1. **Declare** incident severity and assign roles (commander, scribe, ops).
2. **Stabilize**: stop the bleeding; prefer reversible mitigations.
3. **Validate**: confirm success via SLI snapshot + alerts endpoint:
   - `GET /api/admin/payment-ops/alerts`
4. **Recover**: backfill/reconcile if needed.
5. **Close**: capture final impact + next steps.

## Comms templates

### Internal update

> Severity: SevX\n
> Impact: <what’s broken>\n
> Start: <time>\n
> Current status: <mitigated/unmitigated>\n
> Next update: <time>\n

### Customer-facing snippet (if needed)

> We’re investigating an issue affecting payment processing. If you see a payment error, please retry in a few minutes. We’re working to restore normal service.

