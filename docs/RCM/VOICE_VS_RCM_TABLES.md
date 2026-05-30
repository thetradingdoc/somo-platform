# Voice SaaS tables vs RCM / financial tables

> **Last reviewed:** 2026-05-29 (W4-05)

## Separation

| Domain | Tenant key | Default merchant fallback |
|--------|------------|---------------------------|
| **Somo voice SaaS** | `customers.id`, `merchants.id` for settings | Must **not** use `akin-dunbar` for authenticated SaaS owners |
| **RCM / coding / payor** | `clinics`, `merchants` (commerce), payor registry | Legacy demo merchant may exist for codebook eval — do not wire voice settings to it |

## Voice SaaS (see Database docs)

- `customers`, `voice_agent_settings`, `voice_call_log`, `voice_call_states`
- Twilio/Retell columns on `customers`

## RCM / financial (examples)

- `prior_auth_requests`, payor `provider_*` tables, reconciliation, `merchant_orders` for commerce checkout
- Medical code tables: `icd10_codes`, `cpt_codes`, embeddings

## Rule

RCM routes and voice agent settings must not share a **default** `merchant_id` fallback. Voice resolves tenant from `req.customer` or explicit `customer_id` on webhooks.

## Related

- [TENANT_MODEL.md](../Database/TENANT_MODEL.md)
- [Medical Coding/ARCHITECTURE.md](../Medical%20Coding/ARCHITECTURE.md)
