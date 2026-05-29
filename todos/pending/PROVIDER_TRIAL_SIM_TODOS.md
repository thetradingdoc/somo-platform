# Provider SIM trial signup todos

**Status:** complete (v1 implementation)  
**Architecture:** [docs/deployment/PROVIDER_TRIAL_SIM_ARCHITECTURE.md](../../docs/deployment/PROVIDER_TRIAL_SIM_ARCHITECTURE.md)  
**Signup flow:** [docs/deployment/PROVIDER_SIGNUP_FLOW.md](../../docs/deployment/PROVIDER_SIGNUP_FLOW.md)

## P0 — Docs + config

- [x] PROVIDER_TRIAL_SIM_ARCHITECTURE.md
- [x] PROVIDER_SIGNUP_FLOW.md
- [x] VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE D4 = 60 min
- [x] plan-catalog trial knobs
- [x] .env.example TRIAL_SIM_* + TWILIO_VERIFY

## P1 — Schema + services

- [x] customers trial / attribution / phone_verified columns
- [x] trial-lifecycle.js
- [x] twilio-verify-service.js
- [x] billing-access trial gates

## P2 — Cron (dry-run first)

- [x] trial-expiry-sweep.cjs + npm script

## P3 — Signup rewire

- [x] verify-phone send/check routes
- [x] attribution on POST /api/signup
- [x] accept-terms redirect to billing=trial
- [x] signup UI phone step (index.html)

## P4 — Conversion + portal

- [x] convertTrialToPaid on invoice.paid
- [x] getBillingStatus trial fields
- [x] settings.html billing=trial + welcome panel

## P5 — Nudges

- [x] trial-alerts.js SMS + email (50/80%, day 5, day 7, expired)

## P6 — Tests + admin

- [x] __tests__/trial-lifecycle.test.js
- [x] __tests__/billing-access-trial.test.js
- [x] admin trial list / expire / retry provision

## Rollout (ops)

- [ ] `TRIAL_SIM_FLOW_ENABLED=1` on staging (see [PROVIDER_SIGNUP_FLOW.md](../../docs/deployment/PROVIDER_SIGNUP_FLOW.md))
- [ ] Set `TRIAL_SIM_LAUNCH_AT` for new signups only
- [ ] Run `npm run trial:expiry-sweep` (dry-run first) before live numbers
- [ ] Schedule daily `npm run trial:expiry-sweep:apply` (cron example in PROVIDER_SIGNUP_FLOW.md)
- [ ] `npx playwright test --project provider-trial` against staging with SIM enabled

## Alignment (2026-05-28)

- [x] Unified `/signup` phone step + utm attribution + `customer_type=saas`
- [x] accept-terms phone redirect → `/signup?step=phone`
- [x] `GET /api/signup/session` + `provider-session.js` hydration
- [x] E2E `e2e/provider-trial-signup.spec.cjs`
