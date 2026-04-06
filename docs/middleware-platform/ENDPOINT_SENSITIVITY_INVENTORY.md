# Endpoint Sensitivity Inventory

| Endpoint | Sensitivity | Required Controls |
|---|---|---|
| `POST /api/public/checkout-chat/turn` | High | PAN/CVC chat block, stage guardrails, redaction |
| `POST /api/public/checkout-chat/turn/stream` | High | PAN/CVC chat block, stage guardrails, redaction |
| `POST /api/public/commerce/cart/checkout` | High | Tokenized-only input, stage gate, idempotency |
| `POST /api/public/commerce/stripe/confirm-payment` | Critical | Tokenized-only input, PI/session binding, stage gate |
| `GET /api/public/commerce/stripe-config` | Medium | Minimal exposure, no secrets beyond publishable key |
| `GET /api/patient/cards/:cardId` | Critical | Admin auth, strict audit access, business-justified use only |
| `GET /api/admin/metrics` | Medium | No secret leakage in response payloads |

## Authorization Baseline

- Public endpoints: minimal allowed operations + strict request validation.
- Admin-sensitive endpoints: `requireAdminAuth`, role checks, tenant scoping.
- No implicit auth fallback; deny-by-default on mismatch.
