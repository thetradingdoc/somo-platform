# Public agentic checkout (catalog → quote → pay)

Unauthenticated flows for retail products on the patient portal and LittleLab landing. **Charge amounts are never taken from the browser alone** for capture: they come from the product row in SQLite (`products.price`) × quantity, via `PaymentOrchestrator` or payment-link fallback.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/public/products` | Catalog list (scoped by `provider_id` / host when applicable). |
| `POST` | `/api/public/commerce/quote` | Creates `checkout_sessions` with `platform: commerce_quote`, `status: quoted`, and `session_data` (`kind`, `amount_cents`, `product_id`, `merchant_id`, `quantity`). Returns `quote_id`, `amount`, `expires_at`. |
| `POST` | `/api/public/checkout/start` | Ensures `customers` row; creates voice checkout + Stripe / link as today. Optional `quote_id` / `checkout_session_id` must match merchant, product, and non-expired quote; **409 `quote_stale`** if DB price no longer matches `amount_cents`. |

## Trusted vs display-only fields

- **Trusted (server):** `products.price`, inventory, merchant/product association, quote `amount_cents`, orchestrator totals.
- **Display-only / hints:** Any `amount` or `price` the client might send on unrelated legacy paths — public checkout **does not** use client body totals for capture.
- **Idempotency:** `Idempotency-Key` (or `idempotency_key` in body) with operation `public_checkout_start` stores successful JSON for 24h retries.

## Session lifecycle (`checkout_sessions`)

1. **`quoted`** — Created by `/api/public/commerce/quote`.
2. **`payment_pending`** — After `/api/public/checkout/start` successfully creates a checkout (voice checkout id stored in `session_data`).
3. **`paid`** — On Stripe `payment_intent.succeeded`, when PaymentIntent metadata includes `commerce_quote_id` (set for direct Stripe flows from `PaymentOrchestrator`), `stripe-webhook-handler` updates the matching `checkout_sessions` row to status **`paid`** and stores `stripe_payment_intent_id` in `session_data`.

## UI rollout

- **LittleLab landing:** `REACT_APP_CHAT_FIRST_CHECKOUT` (default: on). Set to `false` to hide the chat-first “Ask about this product” CTA and emphasize buy-now only for gradual rollout.

## References

- `middleware-platform/routes/public-commerce-quote.js`
- `middleware-platform/routes/public-checkout.js`
- `unified-dashboard/patients/checkout-chat.html`
- `middleware-platform/openapi.yaml` — tag **Public**
- Manual E2E (staging): `docs/testing/AGENTIC_CHECKOUT_E2E_CHECKLIST.md`
