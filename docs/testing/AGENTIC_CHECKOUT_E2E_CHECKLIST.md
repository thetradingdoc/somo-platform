# Agentic checkout — manual E2E checklist (staging)

Use this when validating **landing → login → checkout-chat → quote → pay → success** end-to-end. **CI** runs static checks (including `npm run verify:agentic-checkout` at the repo root) and middleware Jest; there is **no browser Cypress suite** in-repo until `middleware-platform/cypress/` is restored — see `docs/deployment/CI_AND_DEPLOY_SOURCE_OF_TRUTH.md`.

## Prerequisites

- Middleware running with Stripe test keys and seed products (e.g. demo serums).
- Patient portal reachable at `REACT_APP_PATIENT_PORTAL_PREFIX` (default `/unified-dashboard/patients`).
- LittleLab landing built with `REACT_APP_API_BASE` pointing at the same middleware.

## Flow

1. **Landing — Ask (chat-first)**  
   Open LittleLab → product card → **Ask about this product** → login → lands on `checkout-chat.html` with `product_id` / `provider_id` in the query string.

2. **Quote**  
   Confirm header shows server price; in devtools Network, `POST /api/public/commerce/quote` returns `200` with `quote_id` and `amount`.

3. **Email verification gate (in-chat)**  
   In the payment bubble:
   - Enter email → click **Send code** (`POST /api/public/commerce/email/send-code`, `200`)
   - Enter 6-digit code → click **Verify** (`POST /api/public/commerce/email/verify-code`, `200`)
   - Confirm UI shows **Email verified. You can pay securely now.**
   - Confirm **Pay securely** stays disabled until verification succeeds.

4. **Checkout start**  
   After verification, continue payment. `POST /api/public/commerce/cart/checkout` returns `success` with Stripe client secret + payment intent (or fallback checkout/start path).

5. **Stripe**  
   Complete test card payment; redirect returns to success URL (wallet / payment-success as configured).

6. **Success**  
   - **Visit checkout:** `payment-success.html?appointment_id=…` — pill settles; async vs sync copy matches `visit_mode` from `/api/patient/appointments`.  
   - **Retail only:** open `payment-success.html` without `appointment_id` — retail “Your order” block appears.

## Feature flag

- Set `REACT_APP_CHAT_FIRST_CHECKOUT=false` on the landing build → **Ask** link hidden; bag **Buy** still works.

## Learn vs checkout URL modes (`checkout-chat.html`)

- **Learn / explore:** `intent=learn_more` and `phase3=1` → body `mode-learn`; checkout stepper/cart emphasis stays off until the user converts.
- **Checkout-first:** `intent=checkout_chat` (and optional `source=landing`) → body `mode-checkout`; cart + stepper visible.

**Automated:** from repo root, serve static files (`python3 -m http.server 8765`), then in `middleware-platform`:

`PLAYWRIGHT_BROWSERS_PATH=0 CHECKOUT_E2E_BASE_URL=http://127.0.0.1:8765 npm run test:e2e-checkout-modes`  
Full Kelly journey + in-chat verification + pay:  
`PLAYWRIGHT_BROWSERS_PATH=0 CHECKOUT_E2E_BASE_URL=http://127.0.0.1:8765 npm run test:e2e-kelly-checkout`

## Copy source of truth

- Default strings live in `unified-dashboard/patients/checkout-chat.html` (`DEFAULT_KELLY_COPY`).
- Overrides: `unified-dashboard/copy/checkout-kelly.json` (keep keys in sync when changing UI).

## Cross-device manual matrix (spot-check)

| Surface | Viewport | Check |
|---------|----------|--------|
| iOS Safari | 390×844 | Learn + checkout flows; Stripe Element scroll |
| Android Chrome | 360×800 | Same |
| Desktop Chrome | 1280×720 | Keyboard: Tab to skip link → main → composer |

## Regression spots

- **Timezone:** booking calendar (`schedule.html`) uses `isoDateInTz` + civil `YYYY-MM-DD` for day cells — see `schedule-isoDateInTz.test.js`.  
- **Payable without active pending row:** unpaid visits still expose `payment_status` via FHIR extension or legacy `appointments.payment_status` (see `/api/patient/appointments` merge in `server.js`).
