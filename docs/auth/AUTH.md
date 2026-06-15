# AUTH

**Last updated:** 2026-06-02


---

<a id="admin-vs-provider-login"></a>

## ADMIN VS PROVIDER LOGIN

*Merged from `docs/auth/ADMIN_VS_PROVIDER_LOGIN.md` on 2026-06-02.*

# Admin portal vs provider login

> **Last reviewed:** 2026-05-29 (H-09)

| Surface | URL | Auth mechanism | Identity store |
|---------|-----|----------------|----------------|
| **Provider (Somo)** | `/login` | Email + password | `customers` + `customer_sessions` |
| **Admin / ops** | `/admin` | Shared secret header/cookie | `ADMIN_PORTAL_SECRET` — not `customers` |
| **Patient** | Patient portal routes | OTP / portal session | FHIR + portal tables |
| **Legacy clinic** | `/api/auth/signup`, `users` | Deprecated | `users` |

## Admin portal

- URL: `https://callsomo.com/admin`
- Auth: **Email + password** for the operator account (`SOMO_OWNER_EMAIL`, default `richard@callsomo.com`), then a **6-digit verification code** emailed for step-up security
- Legacy break-glass: `ADMIN_PORTAL_SECRET` still works via API with `{ "secret": "..." }` but is not shown in the UI
- Operator account is also the voice billing identity (`customer_type=operator`, `CALLSOMO_OPERATOR_CUSTOMER_ID`)

## Provider / operator login

- UI: [`unified-dashboard/login.html`](../../unified-dashboard/login.html)
- API: `POST /api/customers/login`
- Same operator email/password as admin (`richard@callsomo.com`) — used for provider portal + voice features
- Bootstrap: `npm run ensure:somo-owner` or `node scripts/setup-richard-admin.cjs`

## Related

- [auth-entrypoints.md](./auth-entrypoints.md)
- [TENANT_MODEL.md](../Database/TENANT_MODEL.md)


---

<a id="api-developer-signup"></a>

## API DEVELOPER SIGNUP

*Merged from `docs/auth/API_DEVELOPER_SIGNUP.md` on 2026-06-02.*

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


---

<a id="legacy-signup-audit"></a>

## LEGACY SIGNUP AUDIT

*Merged from `docs/auth/LEGACY_SIGNUP_AUDIT.md` on 2026-06-02.*

# Legacy signup audit (W4-07 / W4-07c)

> **Last reviewed:** 2026-05-29

## Routes still using `users` table

| Route | File | Action |
|-------|------|--------|
| `POST /api/auth/signup` | auth routes | Returns **410** unless `ALLOW_LEGACY_USERS_SIGNUP=1` |
| Legacy clinic login | `users` + session | Deprecate for new tenants |

## Policy

- **New providers:** `/signup` wizard → `customers` + `provisionSaasTenant` (merchant + clinic + phone).
- **Duplicates:** If both `users` and `customers` exist for the same email:
  1. Run read-only report: `npm run audit:duplicate-identities`
  2. Prefer **customers** row as Somo SaaS identity going forward
  3. Link `users.merchant_id` / `users.clinic_id` to the canonical customer tenant if the user row is still needed for legacy login
  4. **Do not auto-delete** without ops review — document merge in Week 1 handoff

## Merge checklist (manual)

1. Confirm which row has active subscription / Twilio number / Retell agent
2. Copy missing foreign keys (`merchant_id`, `clinic_id`, `retell_agent_id`) onto the canonical **customer**
3. Disable or archive duplicate login path
4. Re-run `audit:duplicate-identities` until zero `users+customers` conflicts

## Target

Single provider identity in `customers` for Somo SaaS; `users` retained only for legacy clinic deployments.


---

<a id="auth-entrypoints"></a>

## auth-entrypoints

*Merged from `docs/auth/auth-entrypoints.md` on 2026-06-02.*

# Auth entrypoints (source of truth)

This repository ships **two distinct user journeys** that share branding/UI tokens but must remain separate to avoid confusion.

## Canonical URLs (do not add alternates)

### Patient Portal (patients)

- **Entry**: `/unified-dashboard/patients/patient-login.html`
  - Passwordless **email OTP sign-in**.
  - “New or returning patient” uses the same sign-in flow.

### Provider Portal (licensed providers)

- **Sign in**: `/login` → `unified-dashboard/login.html`
  - Somo-branded email + password (matches `/signup` shell).
  - Optional **`?redirect=`** query param: after successful login, navigates to a same-origin path (e.g. `/business/agent.html`). Invalid or cross-origin values fall back to `/business/today.html`.
  - **No demo login UI** on this page.
- **Create account**: `/signup` → `unified-dashboard/signup.html`
  - Provider onboarding wizard + email verification.

### Portal router (recommended front door)

- **Choose portal**: `/unified-dashboard/portal.html` (or `/portal` when routed)
  - Routes users to Patient Portal vs Provider Portal (`/login` for providers).

### Local owner credentials (dev only)

- Template: `local/provider-login.credentials.example` → copy to `local/provider-login.credentials` (gitignored).
- Env mirror: `SOMO_OWNER_EMAIL`, `SOMO_OWNER_PASSWORD`, optional `SOMO_OWNER_CLINIC_PHONE` in `middleware-platform/.env`.
- Sync DB: `cd middleware-platform && npm run ensure:somo-owner` — see `local/README.md`.

## Rules (to prevent future drift)

- **No demo/test UI** on `/login` or other production provider pages.
  - Do not add “Quick Test Accounts”, “Demo login”, “TEST MODE”, or similar shortcuts.
- **No alternate entrypoints**.
  - Do not create additional provider login pages; update `/login` instead.
- **No multi-document HTML files**.
  - A single `.html` file must contain exactly one `<head>` section and one closing `</html>`.
- **Auth CTAs on marketing** may link directly to `/signup` or `/login`; the portal router remains the multi-portal front door.

## Marketing landing dev (`somo-landing`)

- Hot reload: `cd unified-dashboard/somo-landing && npm run dev` → `http://localhost:5180`
- Vite proxies `/login`, `/signup`, `/api`, `/unified-dashboard`, and `/business` to middleware (`VITE_API_PROXY`, default `:4000`).
- `VITE_LOGIN_URL` / `VITE_SIGNUP_URL` in `.env.development` — Hero **Sign in** uses `loginUrl()` (default `/login?utm_source=somo` on the dev server).
- Production build on `:4000` uses same paths without a separate port.

## API developer signup (separate host)

- **Canonical doc:** [API_DEVELOPER_SIGNUP.md](./API_DEVELOPER_SIGNUP.md)
- **Entry:** `https://api.callsomo.com/` (sign up / sign in) → `middleware-platform/public/signup/index.html`
- **`customer_type`:** `api` (not the provider wizard on `callsomo.com/signup`)
- **Completion:** `/docs` after terms + card verify
