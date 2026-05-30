# Admin portal vs provider login

> **Last reviewed:** 2026-05-29 (H-09)

| Surface | URL | Auth mechanism | Identity store |
|---------|-----|----------------|----------------|
| **Provider (Somo)** | `/login` | Email + password | `customers` + `customer_sessions` |
| **Admin / ops** | `/admin` | Shared secret header/cookie | `ADMIN_PORTAL_SECRET` — not `customers` |
| **Patient** | Patient portal routes | OTP / portal session | FHIR + portal tables |
| **Legacy clinic** | `/api/auth/signup`, `users` | Deprecated | `users` |

## Provider login

- UI: [`unified-dashboard/login.html`](../../unified-dashboard/login.html)
- API: `POST /api/customers/login`
- Bootstrap: `npm run ensure:somo-owner` — [local/README.md](../../local/README.md)

## Admin portal

- Requires `ADMIN_PORTAL_SECRET` in environment
- Does **not** use `SOMO_OWNER_EMAIL` or `customers.password_hash`
- Do not conflate admin access with SaaS tenant owner access

## Related

- [auth-entrypoints.md](./auth-entrypoints.md)
- [TENANT_MODEL.md](../Database/TENANT_MODEL.md)
