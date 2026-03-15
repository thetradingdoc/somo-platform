# Payment Token Flow (Task 25)

## Overview

Payment links use a token stored in `payment_tokens` and resolved via `getPaymentToken`. The URL pattern is `/payment/{token}`.

## Flow

1. **Create checkout** – `create_checkout` (voice) or `POST /voice/appointments/checkout` creates a `voice_checkouts` row.
2. **Create token** – `db.createPaymentToken({ token, checkout_id, verification_code, verification_code_expires, status })` inserts into `payment_tokens`.
3. **Send link** – Email contains `{BASE_URL}/payment/{token}`.
4. **Resolve token** – `GET /payment/:token` serves the payment page; `GET /api/payment/checkout/:token` returns checkout details via `PaymentService.getCheckoutByToken(token)` which calls `db.getPaymentToken(token)`.
5. **Verify identity** (Task 53) – `verify_checkout_code` sets `status='verified'`, `identity_verified_at=now`. Payment is only allowed when status is `verified`.
6. **Charge** – `POST /api/payment/process` uses `payment_token`; validates via `getPaymentToken` and processes via Stripe.

## Tables

- `payment_tokens`: `token`, `checkout_id`, `verification_code`, `verification_code_expires`, `status`, `identity_verified_at`, `used_at`
- `voice_checkouts`: checkout details including `amount`

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /payment/:token` | Payment page (serves HTML) |
| `GET /api/payment/checkout/:token` | Fetch checkout by token |
| `POST /api/payment/process` | Process payment (requires `payment_token` in body) |

## Route Mapping

- `/payment/:token` in `server.js` → redirects to `/api/payment/:token` or serves payment page
- Payment routes live in `routes/payment.js` under `/api/payment`
