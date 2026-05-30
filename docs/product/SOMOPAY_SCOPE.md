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
