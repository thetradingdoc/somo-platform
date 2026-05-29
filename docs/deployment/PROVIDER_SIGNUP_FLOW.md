# Provider signup flow (SIM trial)

**Last updated:** 2026-05-28  
**Architecture:** [PROVIDER_TRIAL_SIM_ARCHITECTURE.md](./PROVIDER_TRIAL_SIM_ARCHITECTURE.md)

## Primary UI

| Host | Signup page |
|------|-------------|
| Root / marketing (`GET /signup`) | [unified-dashboard/signup.html](../../unified-dashboard/signup.html) |
| API subdomain (`GET /` on api.*) | [middleware-platform/public/signup/index.html](../../middleware-platform/public/signup/index.html) |

Both flows call the same `/api/signup/*` endpoints. Terms: [middleware-platform/public/signup/terms.html](../../middleware-platform/public/signup/terms.html).

## SaaS happy path (SIM enabled)

```text
DodgeCall demo (optional) → /signup?utm_source=dodgecall
  → POST /api/signup (capture attribution, customer_type=saas)
  → POST /api/signup/verify-email (session cookie)
  → POST /api/signup/verify-phone/send
  → POST /api/signup/verify-phone/check → startTrialTenant()
  → POST /api/signup/accept-terms
  → /business/settings.html?billing=trial
  → Use dedicated number (60 min / 7 days)
  → Subscribe (Stripe Checkout) when paused or from banner
```

When `TRIAL_SIM_FLOW_ENABLED` is off, after email verify the UI skips phone and goes straight to `/terms` (legacy paywall / subscribe paths).

## Redirect contract

| Step | Condition | Redirect |
|------|-----------|----------|
| After email verify | SIM on (`trial_sim_flow: true`) | Stay on `/signup?step=phone` (phone panel) |
| After email verify | SIM off | `/terms?redirect=…&customer_type=saas` |
| After phone verify + trial | Trial started | `/terms?customer_type=saas` (then accept-terms → settings) |
| After accept-terms | SIM on, phone not verified | `/signup?step=phone&redirect=…` |
| After accept-terms | SIM on, trial active | `/business/settings.html?billing=trial` |
| After accept-terms | SIM off, needs subscription | `/business/settings.html?billing=subscribe` |
| After accept-terms | Card verified (legacy) | `/signup-complete` |
| After Stripe success | Paid | `/business/settings.html?billing=success` |

## API endpoints

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/signup` | Public |
| POST | `/api/signup/verify-email` | Public (sets `customer_session`) |
| GET | `/api/signup/session` | `customer_session` (email verified; no terms gate) |
| POST | `/api/signup/verify-phone/send` | `customer_session` + email verified |
| POST | `/api/signup/verify-phone/check` | Same |
| POST | `/api/signup/accept-terms` | Session |
| POST | `/api/voice-billing/trial-welcome-dismiss` | Session |
| POST | `/api/voice-billing/checkout/subscription` | Session |
| GET | `/api/voice-billing/status` | Session |

## Portal session (browser)

After verify-email, verify-phone, or accept-terms, the UI calls `GET /api/signup/session` and stores the result in `sessionStorage.customer` via [provider-session.js](../../unified-dashboard/assets/js/provider-session.js) so [provider-shell.js](../../unified-dashboard/assets/js/provider-shell.js) has clinic context without a separate login.

## DodgeCall onboarding copy

When `signup_attribution_json.utm_source === 'dodgecall'` and `welcome=1`:

- **Headline:** Your AI receptionist line is live
- **Subcopy:** You just tried our demo — this number is **yours**. Forward your office line or call it now: `{twilio_phone_number}`
- **CTAs:** Call my number · Open settings · Subscribe to keep this number

Generic variant omits demo reference.

Dismissal: `POST /api/voice-billing/trial-welcome-dismiss` sets `trial_welcome_dismissed_at`.

## DodgeCall bridge

- Demo: shared number, `dodgecall_demo_requests` only
- Signup link: `VITE_SIGNUP_URL` / `DODGECALL_SIGNUP_URL` with `utm_source=dodgecall`
- Provider portal: new tenant; no demo transcript/number carryover

## Staging / cron

Enable on staging:

```bash
TRIAL_SIM_FLOW_ENABLED=1
TRIAL_SIM_LAUNCH_AT=2026-05-28T00:00:00Z   # new signups only after this instant
TWILIO_VERIFY_SERVICE_SID=...
```

Trial expiry / inactivity (dry-run first):

```bash
cd middleware-platform && npm run trial:expiry-sweep
cd middleware-platform && npm run trial:expiry-sweep:apply
```

Example daily cron (UTC 06:00):

```cron
0 6 * * * cd /path/to/middleware-platform && npm run trial:expiry-sweep:apply >> /var/log/trial-expiry-sweep.log 2>&1
```

E2E: `npx playwright test --project provider-trial` (requires middleware on `:4000` and `TRIAL_SIM_FLOW_ENABLED=1`).
