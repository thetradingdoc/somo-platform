# API developer signup (api.callsomo.com)

> **Last reviewed:** 2026-06-02

Self-serve onboarding for **API Integration** customers (`customer_type=api`). Distinct from the provider wizard at [`callsomo.com/signup`](https://callsomo.com/signup) (`customer_type=saas`).

## Canonical URLs

| Step | URL |
|------|-----|
| Sign up / sign in | `https://api.callsomo.com/` or `/login` (same page) |
| Terms (API) | `https://api.callsomo.com/terms?customer_type=api&redirect=/docs` |
| Card verify | `https://api.callsomo.com/verify-card?customer_type=api&redirect=/docs` |
| API docs (gated) | `https://api.callsomo.com/docs` |
| Profile | `https://api.callsomo.com/profile` |

## Flow

1. **Account** — Name, email, optional phone, API feature selection → `POST /api/signup` with `customer_type: "api"`.
2. **Email verify** — 6-digit code → `POST /api/signup/verify-email`.
3. **Terms** — Host serves [`terms-api.html`](../../middleware-platform/public/signup/terms-api.html); accept → `POST /api/signup/accept-terms?customer_type=api`.
4. **Card verify** — Required before `/docs` → `POST /api/signup/verify-card`.
5. **Docs** — Static reference at `/docs` (session + terms + verified card).

## Provider vs API

| | Provider | API developer |
|--|----------|----------------|
| Host | `callsomo.com` | `api.callsomo.com` |
| UI | `unified-dashboard/signup.html` | `middleware-platform/public/signup/index.html` |
| `customer_type` | `saas` | `api` |
| After onboarding | `/business/today.html` | `/docs` |

## Code

- HTML: [`middleware-platform/public/signup/`](../../middleware-platform/public/signup/)
- Routes: [`middleware-platform/routes/signup-trial.js`](../../middleware-platform/routes/signup-trial.js), [`customer-auth.js`](../../middleware-platform/routes/customer-auth.js)
- Host routing: [`middleware-platform/server.js`](../../middleware-platform/server.js) (`isProductionApiHostname`)

## Related

- [auth-entrypoints.md](./auth-entrypoints.md)
- [LOGO_AND_ICON_SSOT.md](../Brand/LOGO_AND_ICON_SSOT.md)
