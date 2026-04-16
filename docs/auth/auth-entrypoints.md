# Auth entrypoints (source of truth)

This repository ships **two distinct user journeys** that share branding/UI tokens but must remain separate to avoid confusion.

## Canonical URLs (do not add alternates)

### Patient Portal (patients)

- **Entry**: `/unified-dashboard/patients/patient-login.html`
  - Passwordless **email OTP sign-in**.
  - “New or returning patient” uses the same sign-in flow.

### Provider Portal (licensed providers)

- **Sign in**: `/unified-dashboard/login.html`
  - Email + password.
- **Create account**: `/unified-dashboard/signup.html`
  - Provider onboarding + email verification.

### Portal router (recommended front door)

- **Choose portal**: `/unified-dashboard/portal.html`
  - Routes users to Patient Portal vs Provider Portal.

## Rules (to prevent future drift)

- **No demo/test UI** in production pages.
  - Do not add “Quick Test Accounts”, “TEST MODE”, or similar shortcuts.
- **No alternate entrypoints**.
  - Do not create additional patient login pages or provider login pages.
  - If you need a new UX, update the canonical page instead.
- **No multi-document HTML files**.
  - A single `.html` file must contain exactly one `<head>` section and one closing `</html>`.
- **Auth CTAs always route to the portal router** unless you are linking from inside a specific portal.
  - External links/landing pages should go to `/unified-dashboard/portal.html`.

