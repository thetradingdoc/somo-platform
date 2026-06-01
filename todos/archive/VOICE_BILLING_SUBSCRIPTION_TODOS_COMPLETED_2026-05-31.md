> Archived from todos/pending/ on 2026-05-31 — v1 complete.

# Voice billing & subscription todos

**Status:** complete (v1 implementation)  
**Architecture:** [docs/deployment/VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md](../../docs/deployment/VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md)  
**Critical path:** Phase 1–2 before Stripe/portal. Pack-only at zero (D1).

## Locked decisions

| ID | Decision |
|----|----------|
| D1 | Pack-only at zero — hard block inbound; no metered overage |
| D2 | Top-ups: $20/100, $30/180, $50/330 min |
| D3 | Starter $79/300, Practice $199/900, Clinic Pro $399/2000; `vertical` flag only |
| D4 | 250 free min until first paid subscription |
| D6 | `past_due` grace: 3 days |
| D7 | Retell pause on suspend; do not auto-delete |
| D8 | Internal free bucket (no Stripe trial webhook v1) |
| D9 | Twilio number retention 30 days after cancel |

---

## Phase 0 — Config + schema

- [x] T11 — DB migration: subscription + billing columns on `customers`
- [x] T11b — `usage_events` table + `topup_balance_minutes` on `customer_credits`
- [x] T12 — `config/plan-catalog.json` + `services/plan-catalog.js`
- [x] T32 — `.env.example` Stripe price ID placeholders

**Definition of done:** Catalog loads; migrations run on startup; no behavior change.

---

## Phase 1 — Unified usage (P0)

- [x] T1 — `services/apply-usage.js` (idempotent, pack-only deduct)
- [x] T2 — Deduction order: plan minutes then top-up
- [x] T3 — Wire `server.js` Twilio status callback
- [x] T4 — Wire `retell-websocket.js` (remove `completed_no_credits` skip)
- [x] T5 — `__tests__/apply-usage.test.js`

**Definition of done:** Both telephony paths call `applyUsage`; tests pass.

---

## Phase 2 — Ingress, provisioning, lifecycle (P0)

- [x] T6 — `services/billing-access.js`
- [x] T7 — `/voice/incoming` TwiML reject when blocked
- [x] T8 — Move Twilio provision out of `signup.js` accept-terms
- [x] T9 — Provisioning gate helper
- [x] T10 — Retell `applyAgentSettings` on suspend
- [x] T36 — `subscription_status` + transitions
- [x] T37 — Webhook handlers (Phase 3)
- [x] T38 — Ingress reads status + grace
- [x] T39 — Retell pause on cancel/suspend
- [x] T40 — `scripts/billing-lifecycle-sweep.cjs`
- [x] T43 — Tier-aware `clinic-rate-limiter`
- [x] T44 — Pass tier limit on inbound + WS

**Definition of done:** Zero-balance inbound rejected; no provision before pay path ready.

---

## Phase 3 — Stripe (P1)

- [x] T15 — Stripe products/prices (env-driven)
- [x] T16 — Subscription checkout routes
- [x] T17 — Webhooks: `invoice.paid`, `subscription.updated/deleted`, top-up checkout
- [x] T18 — Provision number on first `invoice.paid`
- [x] T19 — Align `routes/credits.js` with catalog top-ups
- [x] T20 — Signup trial via catalog; subscription grants cycle minutes on `invoice.paid`

**Definition of done:** Paid subscription grants minutes and provisions number.

---

## Phase 4 — Alerts, admin, invoice cutover (P1–P2)

- [x] T21 — Low balance 20% of plan (not fixed 50 min)
- [x] T22 — Alert on `applyUsage` + email service
- [x] T45 — `billing_enforcement_paused` API
- [ ] T46 — Admin UI toggle (API only; portal UI follow-up)
- [ ] T48 — Inventory pending `monthly_invoices` (manual ops)
- [ ] T49 — Void/supersede pre-cutover voice overage invoices (manual ops)
- [x] T50 — Disable SaaS voice overage invoice generation
- [ ] T51 — Gate `UsageMonitor.saveMonthlyBilling` for voice tenants
- [ ] T52 — Settings invoice list filter

---

## Phase 5 — Provider portal (P2)

- [x] T25 — Settings balance bar + plan + renewal
- [x] T26 — Top-up Checkout buttons
- [x] T27 — Change plan / Stripe portal
- [x] T28 — Replace pay-as-you-go copy
- [x] T29 — Signup redirect → Settings plan picker
- [ ] T30 — Optional agent.html credits banner

---

## Phase 6 — Ops + E2E (P3)

- [x] T31 — Architecture doc maintained
- [ ] T33 — Admin credit allocation alignment
- [x] T34 — E2E script `scripts/voice-billing-e2e-smoke.cjs`
- [x] T35 — `scripts/audit-voice-twilio-numbers.cjs`

---

## Documentation

- [x] Doc — `VOICE_BILLING_SUBSCRIPTION_TODOS.md` (this file)
- [x] Doc — `VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md`
- [x] Doc — `assets/voice-subscription-architecture.svg`
- [x] Doc — Link from `VOICE_CURRENT_ARCHITECTURE.md`

---

## Progress log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-05-28 | 0–6 | v1 implementation: applyUsage, ingress gate, Stripe routes/webhooks, portal Settings UI, lifecycle sweep + smoke tests |
