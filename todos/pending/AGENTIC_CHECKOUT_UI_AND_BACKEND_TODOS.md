# Agentic checkout — open TODOs (backend & integration)

> **Status (May 2026):** P0 commerce paths **partially hardened** (shipping meta, quote linkage, webhook canceled, UI amount alignment). Remaining: full webhook convergence, portal orders UI, E2E proof.

> **Frontend / Skin & Care UI (archived, all done):** [`../archive/AGENTIC_CHECKOUT_UI_FRONTEND_TODOS.md`](../archive/AGENTIC_CHECKOUT_UI_FRONTEND_TODOS.md).

---

## Completed (Mar–May 2026)

| Item | Summary |
|------|---------|
| **#0a** | Commerce bypass of `appointment_id` gate in `/api/payment/process` |
| **#0b** | `customer_phone` NOT NULL + `commerce_quote_id` on `voice_checkouts` |
| **#0c** | `commerce_quote_id` in Stripe PI metadata |
| **#1** | Order creation via webhook + sync safety net on commerce success |
| **#3** | 3DS `return_url` → `/api/payment/success` |
| **#8** | Orchestrator sync path calls `ensureMerchantOrderFromVoiceCheckout` when enabled |
| **#11** | Partial unique indexes for idempotent `merchant_orders` |

---

## Open backlog

| # | Item | Files |
|---|------|-------|
| **12** | Unify legacy vs canonical Stripe webhook paths | P0 partial | `payment_intent.canceled` on canonical handler; legacy remains 410 unless `ALLOW_LEGACY_STRIPE_WEBHOOK=1` |
| **2** | Align manual pay button vs Kelly agent quote amounts | P0 partial | Cart subtotal preferred in `renderPayCTAInChat`; Kelly prepare passes `commerce_quote_id` |
| **4** | Collect and store shipping address end-to-end | P0 partial | `_buildShippingAddressFromMeta` → orchestrator metadata + voice_checkouts |
| **5** | Link Kelly thread ↔ quote row at DB level | P0 partial | `checkout_sessions.kelly_session_id` column + progress upsert on prepare |
| **6** | Orphaned `checkout_sessions` rows grow unbounded | `database.js` |
| **7** | Provider portal hides data that exists in DB | `merchant-orders.html` |
| **9** | Tool-only turns show silence in chat thread | `server.js`, `checkout-chat.html` |
| **10** | After payment redirect, chat context is lost | Partial | `sessionStorage.checkout_chat_return` + Return to chat on `payment-success.html` |

---

## Reference — completed fix details (historical)

<details>
<summary>P0 fixes (#0a–#0c) — implemented</summary>

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

</details>

## Suggested fix order (open items)

| # | Item | Why first |
|---|------|-----------|
| 1 | **#2** Dual quote coordination | Wrong amount risk |
| 2 | **#4** Shipping address | Fulfillment |
| 3 | **#5** Link Kelly session to quote | Debugging |
| 4 | **#12** Webhook path divergence | Revenue integrity |
| 5 | **#7** Portal display | Operator visibility |
| 6 | **#6** Orphan checkout_sessions cleanup | Hygiene |
| 7 | **#9** Tool status events | UX polish |
| 8 | **#10** Post-payment session resume | UX polish |

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
