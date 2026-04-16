# Payment errors — customer-facing taxonomy and support runbook

This document is the **customer-facing** framing for payment failures and disputes. Engineering details live in code (`refund-workflow-service`, `payment-dispute-service`, `settlement-retry-service`) and admin APIs under `/api/admin/payment-ops/*`.

## Customer-facing error families

| Code / symptom | What the customer sees (plain language) | What support does |
|----------------|----------------------------------------|-------------------|
| **Card declined** | “Your bank declined the charge. Try another card or contact your bank.” | Confirm amount, billing address, and that the card allows online/health purchases. Do not retry more than twice without a different payment method. |
| **Insufficient funds** | Same as decline; optionally mention insufficient funds if the processor message indicates it. | Suggest another card or payment method. |
| **Authentication required (3DS)** | “Complete verification with your bank to finish payment.” | Ask the customer to retry and complete the bank prompt; clear browser cache or try another device if the step never appears. |
| **Expired or invalid card** | “This card number or expiry is not valid.” | Re-enter card details; replace expired cards. |
| **Processing timeout** | “We could not confirm payment in time. You may not have been charged.” | Check **Stripe Dashboard → Payments** for the PaymentIntent before taking a second payment. If uncertain, escalate to engineering with `payment_intent_id`. |
| **Duplicate payment concern** | “A charge may already exist for this visit.” | Search by `checkout_id`, appointment id, or customer email; use idempotent refund policy — **never** refund without confirming capture. |
| **Refund pending** | “Your refund was submitted; it may take 5–10 business days to appear.” | Quote processor timelines; point to receipt email if available. |
| **Refund not allowed (window / status)** | “This payment is not eligible for a refund in the app.” | Check eligibility: checkout must be **completed**, Stripe path, within **REFUND_MAX_AGE_DAYS** (default 120), and amount ≤ captured minus prior refunds. Escalate if edge case (partial shipment, clinical exception). |
| **Chargeback / dispute opened** | “Your bank opened a payment dispute. We will respond through the card network.” | Do **not** promise outcomes. Log Stripe dispute id, assign owner from `/api/admin/payment-ops/exception-owners`, follow internal dispute SOP. |
| **Wallet / USDC (Circle)** | “Wallet refunds are not available in-app.” | Escalate to engineering; do not manually promise Stripe-equivalent behavior. |

## Operational references

- **Refund audit**: `GET /api/admin/payment-ops/refunds/audit` (admin auth required).
- **Disputes**: `GET/PATCH /api/admin/payment-ops/disputes` — intake via Stripe webhooks `charge.dispute.*`.
- **Settlement dead-letter** (Circle triple-jump failures after max retries): `GET /api/admin/payment-ops/settlement/dead-letter`.
- **Retry policy (env)**:
  - `SETTLEMENT_RETRY_MAX_ATTEMPTS` — default `8`; `0` = no dead-letter on retry count alone.
  - `SETTLEMENT_RETRY_BASE_MS` — default `60000` (1 minute base backoff).
  - `SETTLEMENT_RETRY_MAX_BACKOFF_MS` — cap for backoff (default 1 hour).
  - `SETTLEMENT_RETRY_JOB_INTERVAL_MS` — worker tick (default 5 minutes).
- **Exception queue ownership**:
  - `PAYMENT_EXCEPTION_DRI_PRIMARY`, `PAYMENT_EXCEPTION_DRI_BACKUP`, optional `PAYMENT_EXCEPTION_OWNER_POOL` (comma-separated, weekly rotation).
  - Persisted overrides: `PUT /api/admin/payment-ops/exception-owners` (`dri`, `backup`, `owner_pool`).

## Support principles

1. **Never** collect full card numbers in tickets; use last-four references from Stripe only.
2. **Confirm** whether money actually moved (Stripe PI status, Circle transfer status) before refunds or duplicate charges.
3. **Document** `workflow_id` from refund responses when troubleshooting audit rows.
