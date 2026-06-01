# RCM ledger migration rollback (G2)

> **Last reviewed:** 2026-05-29

## Scope

Tables: `rcm_payments`, `rcm_journeys`, `rcm_journey_events`, `ledger_entries`, `copay_payments`

## Pre-deploy checklist

1. Snapshot SQLite: `cp middleware-dev.db middleware-dev.db.bak-$(date +%Y%m%d)`
2. Run migrations on staging copy first
3. Verify `npm run test:rcm` and `__tests__/rcm-payment-idempotency.test.js`

## Rollback procedure

1. Stop middleware processes using the DB
2. Restore DB snapshot from backup
3. Revert application code to previous release tag
4. Confirm no orphaned `rcm_payments` without matching `ledger_entries` via:

```sql
SELECT p.id FROM rcm_payments p
LEFT JOIN ledger_entries l ON l.reference_id = p.id
WHERE p.status = 'paid' AND l.id IS NULL;
```

## Idempotency policy (G1)

- Journey events: `dedupe_key` on `rcm_journey_events` — duplicate append returns `{ deduped: true }`
- Payment settlement: Stripe webhook handler must check payment status before second `markPaid`
- Kelly `request_patient_payment`: one open `rcm_payments` row per journey stage transition

## SLO notes (G4)

- Kelly provisioning: monitor `GET /api/kelly/status` latency + `provisioning_state=failed` rate
- Alert when Kelly toggle PATCH error rate > 1% over 15m
