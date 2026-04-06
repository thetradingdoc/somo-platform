# Predeploy Security Checklist (Payment/Checkout)

- [ ] `npm run release:security-gate` passes.
- [ ] No raw PAN/CVC fields accepted by payment endpoints.
- [ ] Stripe confirm path enforces PI/session binding.
- [ ] Stage transition guard prevents checkout rewind from prepared/confirmed.
- [ ] Sensitive endpoints have explicit auth middleware.
- [ ] Redaction tests pass and no plaintext OTP/client_secret leakage in logs.
- [ ] Critical env vars set for target environment.
- [ ] Incident runbook reviewed and on-call owner assigned.

## Checkout UI (patient chat)

- [ ] Smoke `checkout-chat.html`: cart scrolls in-thread; after payment, billing/card bubble is replaced (not left editable). See `docs/CHECKOUT_CHAT_UI_NOTES.md` and `docs/CHECKOUT_UX_QA_CHECKLIST.md`.
- [ ] Optional: `npm run test:e2e-landing-cta` with `CHECKOUT_E2E_BASE_URL` matching how static assets reach the API (set `window.API_BASE` in tests if using `127.0.0.1` vs `localhost`).
