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
