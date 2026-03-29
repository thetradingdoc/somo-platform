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

3. **Checkout start**  
   **Continue to secure checkout** → enter email → **Pay with Stripe**. `POST /api/public/checkout/start` returns `success` and a `payment_link` (or client secret path).

4. **Stripe**  
   Complete test card payment; redirect returns to success URL (wallet / payment-success as configured).

5. **Success**  
   - **Visit checkout:** `payment-success.html?appointment_id=…` — pill settles; async vs sync copy matches `visit_mode` from `/api/patient/appointments`.  
   - **Retail only:** open `payment-success.html` without `appointment_id` — retail “Your order” block appears.

## Feature flag

- Set `REACT_APP_CHAT_FIRST_CHECKOUT=false` on the landing build → **Ask** link hidden; bag **Buy** still works.

## Regression spots

- **Timezone:** booking calendar (`schedule.html`) uses `isoDateInTz` + civil `YYYY-MM-DD` for day cells — see `schedule-isoDateInTz.test.js`.  
- **Payable without active pending row:** unpaid visits still expose `payment_status` via FHIR extension or legacy `appointments.payment_status` (see `/api/patient/appointments` merge in `server.js`).
