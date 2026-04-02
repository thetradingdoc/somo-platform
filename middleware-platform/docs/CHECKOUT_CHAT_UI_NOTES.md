# Checkout chat UI (patient `checkout-chat.html`)

Reference for engineers and QA. Source: `unified-dashboard/patients/checkout-chat.html`.

## Layout

- **Cart + checkout chrome** (`#ccCheckoutCartBlock`) lives **inside** `#chatLog` as the first block so it **scrolls with the chat thread** (not fixed above a tiny message area).
- The main column `#cc-main` scrolls; the chat log no longer uses a short `max-height` trap—more vertical space goes to the conversation.
- **Bottom dock** (`#cc-bottom-dock`) stays fixed for composer + stepper (safe-area aware).

## Stepper

Steps shown in the dock: **Cart → Shipping → Payment → Confirm**.  
There is **no** “Delivery tracking” step in the UI; delivery/invoice details may be communicated on the receipt or later.

## Post-payment security

- On successful Stripe confirmation, **`lockPaymentBubbleAfterSuccess()`** runs: Stripe Elements are destroyed, `#ccInlinePayConfirm` is hidden, and the in-thread billing/card bubble is **replaced** with a short “Payment complete” message so fields are **not left editable** in the DOM.
- The legacy **Exit checkout** button and **post-purchase patient app** promo block were removed as not production-ready for this surface.

## API base URL

- The page defaults `API_BASE` to `http://localhost:4000`. For Playwright or when opening the page via `http://127.0.0.1`, set `window.API_BASE` in an init script to match the page origin so catalog and chat calls do not fail with “Failed to fetch.”

## Related

- Phone normalization for commerce: `utils/phone-e164.js` and `PAYMENT_DATA_HANDLING_STANDARD.md`.
- Landing entry parity: `npm run test:e2e-landing-cta` (`e2e/landing-cta-entry-flows.spec.cjs`).
