# Provider signup flow (SIM trial)

**Last updated:** 2026-05-29  
**Architecture:** [PROVIDER_TRIAL_SIM_ARCHITECTURE.md](./PROVIDER_TRIAL_SIM_ARCHITECTURE.md)

## Primary UI

| Host | Signup page |
|------|-------------|
| Root / marketing (`GET /signup`) | [unified-dashboard/signup.html](../../unified-dashboard/signup.html) — Somo wizard (`signup-wizard.js`, `signup-somo.css`) |
| API subdomain (`GET /` on api.*) | [middleware-platform/public/signup/index.html](../../middleware-platform/public/signup/index.html) |

Marketing signup calls the same `/api/signup/*` endpoints. Terms: [middleware-platform/public/signup/terms.html](../../middleware-platform/public/signup/terms.html) (also inline accept on wizard step 6).

## Somo wizard steps (marketing / `utm_source=somo`)

```text
Landing demo (optional, prefill via sessionStorage somo_signup_prefill)
  → Step 1: Persona cards (use_case)
  → Step 2: Name, business, email, mobile
  → Step 3: Country, city, postal (local number)
  → Step 3b (optional): License / specialty — skippable for healthcare persona
  → POST /api/signup (light SaaS; license only if specialty + license fields sent)
  → Step 4: Email OTP
  → Step 5: Phone SMS (auto-send) → number reveal hero
  → Step 6: Accept terms (wizard) OR /terms
  → POST /api/signup/accept-terms
  → /business/trial-activation.html?welcome=1
  → /business/voice-setup.html (3-step greeting, hours, call your line)
  → /business/agent.html (control center; 60 min / 7 days trial)
  → Subscribe later via Stripe
```

Progress bar shows **Step N of M** (M excludes phone step when `TRIAL_SIM_FLOW_ENABLED` is off).

## SaaS happy path (SIM enabled)

```text
/signup?utm_source=somo|dodgecall
  → POST /api/signup
  → POST /api/signup/verify-email
  → POST /api/signup/verify-phone/send + check → startTrialTenant()
  → POST /api/signup/accept-terms
  → /business/trial-activation.html
```

When `TRIAL_SIM_FLOW_ENABLED` is off, after email verify the wizard skips phone and goes to terms (legacy paywall / subscribe paths).

## Redirect contract

| Step | Condition | Redirect |
|------|-----------|----------|
| After email verify | SIM on (`trial_sim_flow: true`) | `/signup?step=phone` |
| After email verify | SIM off | `/signup?step=terms` or `/terms` |
| After phone verify + trial | Trial started | `/signup?step=terms` (inline) |
| After accept-terms | SIM on, phone not verified | `/signup?step=phone` |
| After accept-terms | SIM on, trial active | `/business/trial-activation.html?welcome=1` → `/business/voice-setup.html` |
| After accept-terms | SIM off, needs subscription | `/business/settings.html?billing=subscribe` |
| After accept-terms | Card verified (legacy) | `/signup-complete` |
| After Stripe success | Paid | `/business/settings.html?billing=success` |

## Signup API — optional license

`POST /api/signup` requires license + specialty only when `medical_specialty` or `require_provider_profile: true` is sent. Light SaaS signups use single `name` plus `phone_number` without provider credential fields.

## API endpoints

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/signup` | Public |
| POST | `/api/signup/verify-email` | Public (sets `customer_session`) |
| GET | `/api/signup/session` | `customer_session` |
| POST | `/api/signup/verify-phone/send` | Session + email verified |
| POST | `/api/signup/verify-phone/check` | Same |
| POST | `/api/signup/accept-terms` | Session |
| POST | `/api/voice-billing/trial-welcome-dismiss` | Session |
| GET | `/api/voice-billing/status` | Session |
| POST | `/api/voice-billing/checkout/subscription` | Session |

## Portal session (browser)

After verify-email, verify-phone, or accept-terms, the UI hydrates `sessionStorage.customer` via [provider-session.js](../../unified-dashboard/assets/js/provider-session.js).

## Trial activation page

[unified-dashboard/business/trial-activation.html](../../unified-dashboard/business/trial-activation.html) — first run after terms:

- Shows dedicated `twilio_phone_number`, trial minutes/days from `GET /api/voice-billing/status`
- Demo-aware copy when `utm_source` is `somo` or `dodgecall` and `somo_signup_prefill` exists
- Primary CTA → `/business/voice-setup.html`
- Dismiss → `POST /api/voice-billing/trial-welcome-dismiss` → voice setup

## Voice agent control center

- [unified-dashboard/business/agent.html](../../unified-dashboard/business/agent.html) — line status, toggle (`PATCH /api/kelly/toggle`), greeting/hours, call KPIs
- Settings → Voice tab is read-only summary with links to `agent.html`
- Live calls read `voice_agent_settings` + `customers.custom_prompt` in [retell-websocket.js](../../middleware-platform/webhooks/retell-websocket.js) via [voice-agent-runtime.js](../../middleware-platform/services/voice-agent-runtime.js)

## Landing → signup prefill

After a successful demo call, [somo-landing](../../unified-dashboard/somo-landing/) stores `somo_signup_prefill` (`name`, `phone`, `use_case`) for the wizard.

## Staging / cron

```bash
TRIAL_SIM_FLOW_ENABLED=1
TRIAL_SIM_LAUNCH_AT=2026-05-28T00:00:00Z
TWILIO_VERIFY_SERVICE_SID=...
```

E2E:

- `npx playwright test middleware-platform/e2e/somo-signup-wizard.spec.cjs`
- `npx playwright test --project provider-trial` (API trial path)
