# Phase 2 NYC Pilot — Go-Live Checklist

## Sandbox complete (Stedi test API — no prod billing)

Run: `npm run verify:phase2-sandbox` from `middleware-platform/`

- [x] `verify:phase2-dental-copay` — unit + E2E scenarios 1–5
- [x] `verify:phase2-ops` — Somo clinic, dental rules, merchant (test Stripe), NPI test
- [x] `VOICE_ELIGIBILITY_SIMULATE=0` with Stedi **test** key (`STEDI_TEST_MODE=1`)
- [x] Sprint C sandbox — live Stedi test 271 → quote → pay link → `pay.html` parity
- [x] Shadow mode — `copay_quote_speak_enabled=0` (amounts not spoken on call)
- [x] `verify-live-copay-call` on sandbox session telemetry

Evidence: `middleware-platform/var/evidence/phase2/sandbox-acceptance.json`

## Deferred until paying customers (production)

Plan todos: `fd2-prod-stedi`, `fd2-stedi-baa-enrollment` in [provider portal plan](/Users/ojrichard/.cursor/plans/provider_portal_production_20d1693f.plan.md).

Code/scripts ready (run on prod when enrolled):

- `npm run setup:phase2-shadow -- --clinic-id <id>` — shadow week (`copay_quote_speak_enabled=0`)
- `npm run verify:stripe-billing-mode` — confirms test vs live Stripe config
- `npm run verify:phase2-billing` — eligibility metering, TCPA, payment idempotency, alerts

Manual ops still required:

- [ ] Stedi **production** API key + real NPI enrolled per pilot tenant
- [ ] `STEDI_TEST_MODE=0` on production voice
- [ ] Stripe **live** Connect (`STRIPE_BILLING_MODE=live`)
- [ ] Shadow week on real calls — compare desk quotes vs `amount_resolution_log`
- [ ] Enable `copay_quote_speak_enabled=1` after shadow week passes

## Ops monitoring

- Admin panel: eligibility checks today/month (`eligibility_usage_events`)
- Thin-271 rate per payer (target: measure before DentalXChange fallback)
- `amount_resolution_log` mismatches — `GET /api/admin/tenants/amount-resolution/mismatches`

## Billing (pilot)

- Absorb Stedi COGS — flat $199 Practice subscription
- Log usage only; no eligibility overage invoices until Day 60+ general release
