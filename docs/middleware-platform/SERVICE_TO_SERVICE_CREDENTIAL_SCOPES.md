# Service-to-service least privilege and scoped tokens

Service tokens are stored hashed in `service_credentials` and validated by scope.

## Supported pattern

- Issue token:
  - `POST /api/admin/payment-ops/service-credentials`
  - Body: `{ "service_name": "...", "scopes": ["payment:alerts:read"], "expires_at": "..." }`
- Use token:
  - `Authorization: Bearer <token>`
- Revoke token:
  - `POST /api/admin/payment-ops/service-credentials/:id/revoke`

## Enforced internal endpoints

- `GET /api/internal/service-ops/payment-alerts` requires `payment:alerts:read`
- `GET /api/internal/service-ops/secret-alerts` requires `secrets:audit:read`

## Scope design guidance

- Grant only needed scopes (`payment:alerts:read` instead of `*`).
- Use short expirations for automation jobs.
- Separate credentials per calling service.

