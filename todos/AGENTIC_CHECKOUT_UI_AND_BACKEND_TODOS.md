# Agentic checkout — open TODOs (backend & integration)

> **Status (March 2026):** Revised after full code-path audit of `stripe-webhook-handler.js`,
> `payment-orchestrator.js`, `ensure-merchant-order-from-voice-checkout.js`, and
> `routes/payment.js`. Two **undocumented P0 blockers** were found (items #0a and #0b below)
> that prevent commerce payment links from being completable at all — fix these before any
> other work matters. The remaining items are re-verified against the live code.

> **Frontend / Skin & Care UI only:** See **[`AGENTIC_CHECKOUT_UI_FRONTEND_TODOS.md`](./AGENTIC_CHECKOUT_UI_FRONTEND_TODOS.md)** (tokens, logo, chat-first layout, landing parity, patient app).

---

## P0 — Commerce payment is completely broken (newly discovered, not in previous TODO)

### 0a. `/api/payment/process` rejects all commerce checkouts with 400

**What happens:** `routes/payment.js` had a hard gate requiring `appointment_id`.

Commerce `voice_checkouts` rows have no `appointment_id`. This gate fired for every
commerce payment link.

**Fix (implemented):** Detect `isCommerceCheckout` (`!appointment_id` and product/merchant)
and bypass the appointment gate; skip telehealth identity verification for commerce.

**Files:** `middleware-platform/routes/payment.js` (the `/process` handler)

---

### 0b. `voice_checkouts.customer_phone TEXT NOT NULL` — orchestrator inserts null

**What happens:** `PaymentOrchestrator.createCheckout` used `customer_phone` that could violate NOT NULL; DB layer also coerces to `0000000000`.

**Fix (implemented):** Normalize phone; persist `commerce_quote_id` on `voice_checkouts` when present.

**Files:** `middleware-platform/services/payment-orchestrator.js`, `middleware-platform/database.js`

---

### 0c. `commerce_quote_id` never set in Stripe PI metadata — quote row never marked paid

**What happens:** PI metadata omitted `commerce_quote_id`, so webhooks could not mark `checkout_sessions` paid or link orders.

**Fix (implemented):** Store `commerce_quote_id` on `voice_checkouts`; include in PI metadata in `/api/payment/process`, `_handleStripePayment`, and `createStripePaymentIntent`.

**Files:** `middleware-platform/routes/payment.js`, `middleware-platform/services/payment-orchestrator.js`,
`middleware-platform/database.js` (`commerce_quote_id` column + updates in `createVoiceCheckout`)

---

## P0 — Revenue integrity (existing items, re-verified)

### 1. Orders silently vanish after payment — corrected description

**Previous description was partially wrong.** After code audit:

`reconcileMerchantOrderPaymentSucceeded` **does** call `ensureMerchantOrderFromVoiceCheckout`
when `checkout_id` is in PI metadata. **Fixes applied:**

- **Sync safety net:** `routes/payment.js` calls `ensureMerchantOrderFromVoiceCheckout` on commerce success.
- **Reconcile fallthrough:** if `order_id` in metadata points to a missing row, reconcile now attempts creation from `voice_checkout` when `checkout_id` is present.
- **`commerce_quote_id` in metadata** — see #0c.

**Files:** `middleware-platform/routes/stripe-webhook-handler.js`, `middleware-platform/routes/payment.js`

---

### 2. Manual pay button and Kelly agent may charge different quote amounts

*(Unchanged from previous TODO — still valid)*

**Files:** `middleware-platform/server.js`, `unified-dashboard/patients/checkout-chat.html`,
`patient-app/app/checkout-chat.tsx`, `middleware-platform/services/kelly-tool-executor.js`

---

### 3. Stripe 3DS `return_url` routes to the wrong page

**Fix (implemented):** `return_url` set to `/api/payment/success` in `payment.js` `paymentIntents.create` and orchestrator paths that create PIs.

**Files:** `middleware-platform/services/payment-orchestrator.js`, `middleware-platform/routes/payment.js`

---

### 4. Shipping address is never collected or stored

*(Unchanged — still valid, confirmed in code)*

**Files:** `middleware-platform/services/kelly-agent-service.js`,
`middleware-platform/services/kelly-tool-executor.js`,
`middleware-platform/routes/public-checkout.js`, `middleware-platform/database.js`

---

## P1 — Data model and consistency

### 5. Kelly thread and quote row are unlinked at the DB level

*(Unchanged — still valid)*

### 6. Orphaned `checkout_sessions` rows grow unbounded

*(Unchanged — still valid)*

### 7. Provider portal hides data that exists in the database

*(Unchanged — still valid)*

### 8. `PaymentOrchestrator` marks `voice_checkouts` complete without creating `merchant_orders`

**Re-verified:** Sync success path now calls `ensureMerchantOrderFromVoiceCheckout` when enabled (or via `payment.js` for process route). `COMMERCE_ORDER_FROM_WEBHOOK_ONLY` env can still skip orchestrator path.

**Files:** `middleware-platform/services/payment-orchestrator.js`, `middleware-platform/routes/payment.js`

---

## P1 — Idempotency

### 11. Idempotent `merchant_orders` insert from webhooks — no DB constraint

**Re-verified:** Partial unique indexes exist in `database.js` (`migrateMerchantOrderCommerceIdempotency`).

**Files:** `middleware-platform/database.js`, `middleware-platform/services/ensure-merchant-order-from-voice-checkout.js`

---

### 12. Legacy vs canonical Stripe webhook paths diverge

*(Unchanged — still valid)*

---

## P2 — UX

### 9. Tool-only turns show silence in the chat thread

*(Unchanged — still valid)*

### 10. After payment redirect, chat context is lost

*(Unchanged — still valid)*

---

## Suggested fix order (updated)

| # | Item | Why first |
|---|------|-----------|
| 1 | **#0a** appointment_id gate | Commerce payment literally cannot complete |
| 2 | **#0b** customer_phone NOT NULL | Agent checkout cannot create voice_checkout row without phone |
| 3 | **#0c** commerce_quote_id in PI metadata | Quote → order audit trail |
| 4 | **#1** (revised) + sync safety net | Order creation reliable even without webhook |
| 5 | **#11** DB unique constraint | Idempotency at DB layer for webhook retries |
| 6 | **#3** 3DS return_url | Blocks 3DS card payments |
| 7 | **#2** Dual quote coordination | Wrong amount risk |
| 8 | **#4** Shipping address | Fulfillment |
| 9 | **#8** Orchestrator single authoritative createOrder | Consistency |
| 10 | **#14** Quote/checkout/PI ids on merchant_orders | Support + audit |
| 11 | **#5** Link Kelly session to quote | Debugging |
| 12 | **#7** + **#16** Portal display | Polish |
| 13 | **#6** Orphan checkout_sessions cleanup | Hygiene |
| 14 | **#9** Tool status events | UX polish |
| 15 | **#10** Post-payment session resume | UX polish |

---

## Reference: files touched by all fixes

| File | Fixes |
|------|-------|
| `middleware-platform/routes/payment.js` | #0a, #0c, #1, #3 |
| `middleware-platform/services/payment-orchestrator.js` | #0b, #0c, #3, #8 |
| `middleware-platform/routes/public-checkout.js` | #0c, #4 |
| `middleware-platform/routes/stripe-webhook-handler.js` | #1, #8, #11 |
| `middleware-platform/services/ensure-merchant-order-from-voice-checkout.js` | #0c, #11 |
| `middleware-platform/database.js` | #0b, #0c, #4, #5, #6, #11 |
| `middleware-platform/services/kelly-agent-service.js` | #2, #4 |
| `middleware-platform/services/kelly-tool-executor.js` | #2, #4 |
| `middleware-platform/adapters/voice-adapter.js` | #4 |
| `middleware-platform/server.js` | #2, #9 |
| `middleware-platform/routes/voice.js` | #15 |
| `middleware-platform/public/payment/payment.js` | #1, #15 |
| `middleware-platform/public/payment/success.html` | #3, #10 |
| `unified-dashboard/patients/checkout-chat.html` | #2, #5, #9, #10 |
| `unified-dashboard/business/merchant-orders.html` | #7, #16 |
| `patient-app/app/checkout-chat.tsx` | #2, #5, #9 |
