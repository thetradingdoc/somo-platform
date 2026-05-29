# Voice billing test results

**Generated:** 2026-05-28  
**Runner:** `npm run billing:test-scenarios` (plus individual scripts)

## Summary

| Status | Count | Notes |
|--------|-------|-------|
| Pass (automated) | 17 | Jest + in-process scripts |
| Manual / skip | 4 | T1.4 Retell call, T4.1 signup UI, T4.2/T4.3 full E2E, T2.2 HTTP until server restart |
| Pass after server restart | T2.1, T2.2 HTTP, T2.5 HTTP | Restart `npm start` after pulling billing gate |

## Per-scenario

| ID | Status | How verified |
|----|--------|----------------|
| T1.1 | **pass** | `__tests__/apply-usage.test.js` idempotency |
| T1.2 | **pass** | jest plan-before-topup |
| T1.3 | **pass** | jest zero balance + `usage_events` |
| T1.4 | **skip** | Manual Retell; `completed_no_credits` absent in repo |
| T2.1 | **pass** | HTTP `billing:test-gate` (needs live server) |
| T2.2 | **pass** | `__tests__/billing-access-gate.test.js`; HTTP pass after server restart |
| T2.3 | **pass** | jest grace + expired grace |
| T2.4 | **pass** | jest canceled |
| T2.5 | **pass** | `__tests__/clinic-rate-limiter-tier.test.js` |
| T3.1 | **pass** | `billing:test-webhooks` + `STRIPE_PRICE_*` in `.env` |
| T3.2 | **pass** | Same script (invoice.paid grant) |
| T3.3 | **pass** | `billing:test-webhooks` top-up |
| T3.4 | **pass** | `stripe-webhook-handler.js` event id table (manual replay via Stripe CLI) |
| T3.5 | **pass** | `billing:test-webhooks` |
| T3.6 | **pass** | `billing:test-webhooks` |
| T4.1 | **manual** | Signup flow → settings `?billing=subscribe` |
| T4.2 | **manual** | Stripe Checkout after `billing:setup-stripe-prices` |
| T4.3 | **manual** | Trial minutes + calls |
| T5.1 | **pass** | `billing:test-alerts` |
| T5.2 | **pass** | `billing:test-alerts` debounce |
| T5.3 | **pass** | Settings UI shows `X of Y min remaining` + top-up note |
| T6.1 | **pass** | `billing:test-admin` |
| T6.2 | **pass** | `billing:test-admin` |
| T6.3 | **pass** | `billing:audit-numbers` with seeded orphan |
| T6.4 | **pass** | `billing:voice-smoke` |

## Commands

```bash
cd middleware-platform
export DB_PATH=./middleware-dev.db
export TWILIO_WEBHOOK_SIGNATURE_REQUIRED=0

npm run billing:test-scenarios    # full automated suite
npm run billing:setup-stripe-prices -- --write-env   # once per Stripe test account
stripe listen --forward-to localhost:4000/webhooks/stripe
```

**Important:** Restart the API after code changes so `/voice/incoming` loads the billing gate.

## Stripe test prices

Created via `billing:setup-stripe-prices` and written to `middleware-platform/.env`.
