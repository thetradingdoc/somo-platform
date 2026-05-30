# Somo SaaS tenant model

> **Last reviewed:** 2026-05-29

## Three keys (today)

The platform evolved multiple tenant identifiers. They are **not** enforced as a strict 1:1:1 today.

| Key | Table | Primary use |
|-----|-------|-------------|
| `merchant_id` | `merchants` | Commerce subdomain, catalog, `voice_agent_settings` (preferred) |
| `customer_id` | `customers` | Provider `/login`, trial/Stripe, Twilio/Retell columns |
| `clinic_id` | `clinics` | Appointments, FHIR-adjacent flows, `clinic_phone_numbers` |

Legacy `users` rows still exist for older clinic-operator login; new Somo provider sign-in uses **`customers`** + `customer_sessions`.

## Target model (Week 2+)

For `customer_type = 'saas'` after onboarding completes:

```text
customers.merchant_id  →  merchants.id   (NOT NULL)
customers              →  clinics        (1 clinic per SaaS tenant, typical)
customers              →  users          (optional; deprecate for new signups)
```

Signup should create **merchant + customer + clinic** in one transaction (W2-04) so there are no customer-only trial orphans.

## Synthetic merchant keys (anti-pattern)

`voice_agent_settings` may use `merchant_id = 'cust:{customerId}'` when no real merchant exists. On merchant link, migrate to the real `merchant_id` (W2-06, D3-08).

## Default merchant fallback (P0)

Code paths that fall back to subdomain `akin-dunbar` when tenant context is missing cause **wrong greetings and Kelly config** for logged-in owners. Week 1 fixes this in:

- [`routes/voice-agent-settings.js`](../../middleware-platform/routes/voice-agent-settings.js)
- [`webhooks/retell-websocket.js`](../../middleware-platform/webhooks/retell-websocket.js)

Authenticated requests with `req.customer` must never resolve settings for another merchant.

## Auth entrypoints

| Surface | Identity store | Doc |
|---------|----------------|-----|
| Provider portal `/login` | `customers` | [auth-entrypoints.md](../auth/auth-entrypoints.md) |
| Admin `/admin` | `ADMIN_PORTAL_SECRET` (not email) | [ADMIN_VS_PROVIDER_LOGIN.md](../auth/ADMIN_VS_PROVIDER_LOGIN.md) |
| Patient portal | FHIR + portal sessions | auth-entrypoints.md |
| Legacy `/api/auth/signup` | `users` | Deprecate → `/signup` wizard (W4-07) |

## SQL: owner census (D2-04)

```sql
SELECT id, email, merchant_id, clinic_id, customer_type, trial_status,
       twilio_phone_number, retell_agent_id, phone_number, phone_verified
FROM customers
WHERE lower(email) = lower(?);
```

## Related

- [PHONE_NUMBERS.md](./PHONE_NUMBERS.md)
- [VOICE_AGENT_STATE.md](./VOICE_AGENT_STATE.md)
- [ENV_AND_DB_SSOT.md](./ENV_AND_DB_SSOT.md)
