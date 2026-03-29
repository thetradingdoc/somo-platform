# Agentic Commerce Rollout Plan

## Summary
This rollout introduces “agentic commerce” on the provider side:
- Provider UI can request product recommendations based on customer intent.
- Provider UI can create **draft orders** via `/api/orders`.
- Stripe webhooks reconcile order payment state from `pending_payment` to `paid`/`failed`.

## What Changed (Scope)
1. Provider UI
   - `unified-dashboard/business/products.html`: Agentic Commerce panel with recommendation + draft order creation.
   - `unified-dashboard/business/orders.html`: Order list, filters, and improved empty/error messaging.
2. Backend
   - `middleware-platform/routes/orders.js`: idempotent order creation + lifecycle defaults (`status=pending`, `payment_status=pending_payment`).
   - `middleware-platform/routes/stripe-webhook-handler.js`: reconcile merchant order payment on Stripe payment intent events.
3. Observability
   - Ops counters are emitted for order create/status/pay outcomes (see “Monitoring Signals”).

## Feature Flag
### UI-only toggle (safe)
To disable the provider Agentic Commerce UI without changing backend behavior:
- Query parameter: `?agentic=0`
- Local storage: `localStorage.setItem('agentic_commerce_ui','0')`

This hides the Agentic Commerce panel on `unified-dashboard/business/products.html`.

## Rollout Stages
### Stage 1: Enable on a single environment
1. Deploy backend changes first.
2. Rebuild and deploy the provider UI pages.
3. Confirm landing/provider routing still works at `/`.

### Stage 2: Validate funnel behavior (core checks)
1. Create an order from Agentic Commerce:
   - Use any existing product + enter an email.
   - Confirm order appears on `Orders` page.
2. Confirm payment lifecycle:
   - Orders should be created with `payment_status=pending_payment`.
   - On Stripe webhook events, payment reconciliation updates to `paid` or `failed`.
3. Confirm status update endpoint:
   - Verify `PUT /api/orders/:id/status` updates `status` only.

## Monitoring Signals
Watch these counters in `ops_counters`:
1. `merchant_order_create_attempt`
2. `merchant_order_create_success`
3. `merchant_order_create_failed`
4. `merchant_order_status_updated`
5. `merchant_order_payment_paid`
6. `merchant_order_payment_failed`

Operational log markers:
- Backend logs:
  - `📊 [agentic-commerce] order_created`
  - `📊 [agentic-commerce] order_status_updated`
  - `[StripeWebhook] merchant order paid`
  - `[StripeWebhook] merchant order payment failed`

### Alert Threshold Suggestions
- If `merchant_order_create_failed` spikes > 2x baseline, disable UI (`agentic=0`) and investigate inventory/product lookup failures.
- If `merchant_order_payment_failed` rises, validate webhook metadata mapping (`order_id`/`merchant_order_id`) and Stripe event processing.

## Manual QA Checklist
1. Provider UI
   - Agentic panel renders and can be hidden using `?agentic=0`.
   - Empty states:
     - No products -> “No Products Yet” prompt to add products.
     - No orders -> “Create one from Products → Agentic Commerce”.
2. Backend
   - Order creation requires:
     - `product_id`
     - `quantity > 0` integer
     - `customer_email`
   - Idempotency:
     - Repeat the same request with `Idempotency-Key` header should not double-create.
3. Webhook reconciliation (test or staging)
   - Create a draft order.
   - Trigger or simulate `payment_intent.succeeded`.
   - Confirm merchant order is updated to `payment_status=paid`.

## Fallback / Rollback
If issues occur:
1. Hide provider Agentic Commerce UI (disable via `?agentic=0` or local storage).
2. Backend payment reconciliation remains safe because:
   - Order creation is idempotent.
   - Webhook reconciliation is guarded by order existence lookup.
3. Continue operations through existing manual order flows (if any) while investigating.

## Owners
- Primary implementer: (current repo agent)
- Reviewer: (add your name/team)

