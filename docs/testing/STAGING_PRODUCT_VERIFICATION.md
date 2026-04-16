# Staging verification — commerce quote parity and chat → pay

CI proves **static** contracts (syntax, Jest smoke, agentic checkout file checks, patient-app `tsc`). It does **not** prove Stripe, Kelly tool quotes, and manual checkout use the same amounts.

## Quote parity (Kelly vs manual)

1. In staging, open checkout chat with a known `product_id` / `provider_id`.
2. Ask Kelly to quote (or trigger `get_product_quote`) and note `quote_id` and amount from the tool / UI.
3. Call `POST /api/public/commerce/quote` with the same product/provider (or use **Pay without chat** path) and compare **amount** and **quote_id** behavior to your product rules.
4. Document any intentional divergence in `todos/pending/AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md`.

## Chat → quote → pay (manual / staging)

Follow **[AGENTIC_CHECKOUT_E2E_CHECKLIST.md](./AGENTIC_CHECKOUT_E2E_CHECKLIST.md)** with real Stripe test keys. Record the run in your release notes when promoting builds.
