# PRODUCT

**Last updated:** 2026-06-02


---

<a id="somopay-scope"></a>

## SOMOPAY SCOPE

*Merged from `docs/product/SOMOPAY_SCOPE.md` on 2026-06-02.*

# Somopay product scope (W4-08)

> **Last reviewed:** 2026-05-29 — one-pager for access and routing.

## What Somopay is

Payment and subscription flows for **Somo SaaS providers** (`customer_type=saas`): trial conversion, voice usage billing, and related Stripe objects tied to `customers`.

## Routes (representative)

- Stripe webhooks: `POST /webhooks/stripe`
- Customer billing APIs under `/api/customers/*` (subscription, usage)
- Trial SIM: `/api/trial/*` when `TRIAL_SIM_FLOW_ENABLED=1`

## Who gets access

| Actor | Access |
|-------|--------|
| SaaS `customers` with active/trial subscription | Own billing portal data |
| `customer_type=saas` + completed onboarding | Requires `merchant_id` (W2-05) |
| RCM-only / legacy clinic users | Not Somopay primary; use clinic/commerce paths |
| Admin | Ops metrics via `/api/admin/*` + `ADMIN_PORTAL_SECRET` |

## Tables

- `customers` — Stripe customer id, trial fields, plan
- `voice_call_log` — usage metering
- `merchant_orders`, payment integrity tables — commerce checkout (distinct from voice subscription)

## Related

- [TENANT_MODEL.md](../Database/TENANT_MODEL.md)
- [ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md) — Stripe env vars


---

<a id="trial-nudge-emails"></a>

## TRIAL NUDGE EMAILS

*Merged from `docs/product/TRIAL_NUDGE_EMAILS.md` on 2026-06-02.*

# Trial nudge emails (W4-09)

> **Last reviewed:** 2026-05-29

| Trigger | When | `nudge_key` | Send path |
|---------|------|-------------|-----------|
| Day 0 welcome | `activateTrialRecord` / trial start | `trial_welcome` | `maybeSendTrialWelcome()` |
| 50% minutes | Active trial usage | `usage_50` | `maybeSendTrialUsageNudges()` |
| 80% minutes | Active trial usage | `usage_80` | `maybeSendTrialUsageNudges()` |
| 2 days before expiry | Scheduled sweep | `day_5_warning` | `runScheduledTrialNudges()` |
| 1 day before expiry | Scheduled sweep | `day_7_morning` | `runScheduledTrialNudges()` |
| Trial expired | Expiry sweep / lifecycle | `trial_expired` | `maybeSendTrialLifecycleNudges()` |

Brand name in copy: **Somo** (override sender display via `EMAIL_FROM_NAME`).

## Commands

```bash
cd middleware-platform
npm run trial:nudge-sweep          # scheduled day-5 / day-7 + usage nudges
npm run trial:expiry-sweep:apply   # expire trials + release numbers
```

Dev: set `SMTP_*` or Azure Communication env vars; inspect `trial_nudges` table for dedupe.

See [trial-lifecycle.md](../runbooks/trial-lifecycle.md).
