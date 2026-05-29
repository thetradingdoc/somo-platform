# Voice subscription billing architecture

> **Last reviewed:** 2026-05-28  
> **Status:** Target architecture (implementation in progress)  
> **Voice telephony:** [VOICE_CURRENT_ARCHITECTURE.md](./VOICE_CURRENT_ARCHITECTURE.md)  
> **Task tracker:** [todos/pending/VOICE_BILLING_SUBSCRIPTION_TODOS.md](../../todos/pending/VOICE_BILLING_SUBSCRIPTION_TODOS.md)

![Voice subscription billing architecture](./assets/voice-subscription-architecture.svg)

## Scope

This document covers **platform billing** for the AI receptionist (SaaS customer): subscriptions, minute buckets, top-ups, ingress gating, and Twilio provisioning.

It does **not** cover **RCM practice revenue** (patient claims, invoices, patient payments) in [`unified-dashboard/business/billing.html`](../../unified-dashboard/business/billing.html).

## Locked product decisions

| ID | Decision |
|----|----------|
| D1 | Pack-only at zero — hard block inbound; no metered $0.05 overage |
| D2 | Top-ups: $20/100, $30/180, $50/330 min |
| D3 | Starter $79/300, Practice $199/900, Clinic Pro $399/2000 |
| D4 | **60** free SIM trial minutes (7-day cap) until first paid subscription; see [PROVIDER_TRIAL_SIM_ARCHITECTURE.md](./PROVIDER_TRIAL_SIM_ARCHITECTURE.md) |
| D6 | `past_due` grace: 3 days, then suspend |
| D7 | Retell agent paused on suspend; not auto-deleted |
| D9 | Twilio number held 30 days after cancel, then released |

## Plan catalog

Source: [`middleware-platform/config/plan-catalog.json`](../../middleware-platform/config/plan-catalog.json)

| Tier | Price/mo | Included min | Numbers | Rate limit (/min) |
|------|----------|--------------|---------|-------------------|
| starter | $79 | 300 | 1 | 30 |
| practice | $199 | 900 | 1 | 75 |
| clinic_pro | $399 | 2000 | 2 | 150 |

`vertical` (`general` | `healthcare`) changes display labels and HIPAA flags only — not a second price ladder.

## Target vs current (delta)

| Area | Current (pre-migration) | Target |
|------|-------------------------|--------|
| Usage deduction | Split: Twilio `deductCredits` vs Retell pre-check | Single `applyUsage()` |
| Inbound at 0 min | Warn only; call connects | TwiML reject |
| Number provision | SIM trial: on phone verify; legacy: after `invoice.paid` | Trial + paid paths in `trial-lifecycle.js` |
| Subscriptions | Card verify + pay-as-you-go | Stripe Subscription + catalog |
| Overage | $0.05/min tracked, not auto-charged | None (pack-only) |
| Tier limits | Global 150 req/min | Per-tier from catalog |

## Subscription state machine

```text
                    ┌─────────────┐
     signup/trial   │   trialing   │ (free minutes, no sub)
                    └──────┬──────┘
                           │ invoice.paid
                           ▼
                    ┌─────────────┐
              ┌────│   active    │────┐
              │    └─────────────┘    │
   payment    │                       │ cancel / unpaid end
   failed     ▼                       ▼
        ┌─────────────┐        ┌─────────────┐
        │  past_due   │        │  canceled   │
        │  (3d grace) │        │  (30d # hold)│
        └──────┬──────┘        └─────────────┘
               │ grace expired
               ▼
        ┌─────────────┐
        │  suspended  │  Retell enabled=false, inbound blocked
        └─────────────┘
```

## Stripe webhook matrix

| Event | Action |
|-------|--------|
| `invoice.paid` | Set `subscription_status=active`, grant `included_minutes_per_cycle`, `cycle_reset_at`, sync `plan_tier`; provision Twilio if missing |
| `customer.subscription.updated` | Map Stripe status → `active` / `past_due` / `canceled`; set `past_due_since` |
| `customer.subscription.deleted` | `canceled`, `canceled_at`, `number_retention_until` |
| `checkout.session.completed` (payment) | Add `topup_balance_minutes`; record purchase |

Handler: [`middleware-platform/services/voice-billing-stripe.js`](../../middleware-platform/services/voice-billing-stripe.js) via [`routes/stripe-webhook-handler.js`](../../middleware-platform/routes/stripe-webhook-handler.js).

## Ingress gate

Evaluated on `POST /voice/incoming` via [`billing-access.js`](../../middleware-platform/services/billing-access.js):

1. `billing_enforcement_paused` → allow (support override)
2. `subscription_status` in `suspended` / `canceled` (and past_due past grace) → reject
3. `total_minutes` (plan + top-up + balance) ≤ 0 → reject
4. Else → allow (subject to tier rate limit)

Reject response: TwiML `<Say>` + `<Hangup>`.

## Usage application

On call end (Twilio status **or** Retell WS — same code path):

1. Idempotency: `usage_events.call_id` UNIQUE
2. Deduct up to requested minutes: **plan pool first**, then **top-up** (pack-only — never negative)
3. Track `monthly_usage.voice_minutes_used` for reporting

## Environment variables

See [`middleware-platform/.env.example`](../../middleware-platform/.env.example) — `STRIPE_PRICE_*` for subscription and top-up price IDs.

## Related files

| File | Role |
|------|------|
| `services/apply-usage.js` | Unified deduction |
| `services/billing-access.js` | Gate + provision rules |
| `services/plan-catalog.js` | Catalog loader |
| `services/voice-billing-stripe.js` | Stripe webhook + checkout helpers |
| `routes/voice-billing.js` | Checkout API |
| `scripts/billing-lifecycle-sweep.cjs` | Grace expiry, number release |
