# DocLittle Payment Architecture — Wiring Guide

## What is wired

| File | Purpose |
|------|---------|
| `routes/stripe-webhook-handler.js` | Receives Stripe events, marks payments paid, triggers Circle payout, builds case summary |
| `routes/payment-page-route.js` | Creates Stripe PaymentIntents, serves client_secret to the payment page |
| `public/payment-page.html` | Patient-facing Stripe Elements UI (what the email link opens) |
| `routes/provider-case-summary-route.js` | Provider-facing API: list appointments, get SOAP note + triage, add notes |

---

## .env additions

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # from Stripe Dashboard → Webhooks → signing secret

# Circle (USDC provider payouts)
CIRCLE_API_KEY=TEST_API_KEY:...
CIRCLE_MASTER_WALLET_ID=...       # your platform wallet ID
CIRCLE_SANDBOX=1                  # set to 0 for production

# Platform fee (20% default)
PLATFORM_FEE_PCT=0.20

# Provider wallet (fallback when appointment has no practitioner)
CIRCLE_PROVIDER_WALLET_ID=...
CIRCLE_PROVIDER_WALLET_ID_CLINIC_<CLINIC_ID>=...
CIRCLE_PROVIDER_WALLET_ID_MERCHANT_<MERCHANT_ID>=...

# App URL
APP_BASE_URL=https://your-domain.com
```

---

## Local testing

1. Run migrations: `npm run migrate`
2. Start Stripe webhook forwarding:
   ```bash
   stripe listen --forward-to localhost:4000/webhooks/stripe
   ```
3. Copy the `whsec_...` from the CLI output into `.env` as `STRIPE_WEBHOOK_SECRET`
4. Test payment with card `4242 4242 4242 4242`
5. Watch server logs for `[StripeWebhook]` output

---

## Stripe Dashboard webhook (production)

1. Developers → Webhooks → Add endpoint
2. URL: `https://your-domain.com/webhooks/stripe`
3. Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy signing secret → `.env` as `STRIPE_WEBHOOK_SECRET`

---

## Provider portal auth

- **X-Provider-Id** header: pass practitioner ID (or email) for API calls
- **customer_session** cookie: when logged in as a provider customer

---

## Email link format

The payment link in verification emails should be:

```
https://your-domain.com/payment/<payment_token>
```

The patient lands on `payment-page.html`, which fetches `/payment/<token>` (JSON) for `client_secret` and mounts Stripe Elements.

---

## Flow summary

```
Patient enters code → verify_checkout_code
    ↓
GET /payment/<token>          → payment-page.html loads
    ↓
GET /payment/<token> (JSON)   → backend creates PaymentIntent, returns client_secret
    ↓
Stripe Elements mounted       → patient enters card
    ↓
stripe.confirmPayment()       → card charged by Stripe
    ↓
POST /webhooks/stripe          → payment_intent.succeeded event
    ↓
  ├── Mark appointment paid in DB
  ├── Resolve provider wallet (env or clinic)
  ├── POST /v1/transfers (Circle USDC payout to provider)
  ├── Send patient receipt email
  └── Build case_summaries row (provider portal reads this)
```

**Money moves.** Patient pays → platform keeps 20% → provider gets 80% in USDC.
