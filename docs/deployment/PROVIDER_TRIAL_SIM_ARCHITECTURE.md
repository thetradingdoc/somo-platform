# Provider SIM trial architecture

**Last updated:** 2026-05-28  
**Status:** Implemented (feature-flagged)  
**Signup flow:** [PROVIDER_SIGNUP_FLOW.md](./PROVIDER_SIGNUP_FLOW.md)  
**Voice billing:** [VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md](./VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md)  
**Task tracker (archived v1):** [todos/archive/PROVIDER_TRIAL_SIM_TODOS_COMPLETED_2026-05-31.md](../../todos/archive/PROVIDER_TRIAL_SIM_TODOS_COMPLETED_2026-05-31.md)

## Product contract

| Rule | Value |
|------|--------|
| Trial gate | Phone verified via **Twilio Verify** (not email alone) |
| Trial minutes | **60** (from `plan-catalog.json` `signup_trial_minutes`) |
| Time cap | **7 days** from phone verify (`trial_expires_at`) |
| Access ends when | Minutes exhausted **or** day 7, whichever first |
| Number release | Trial expired without active subscription; or **21 days** no call activity |
| Conversion | Stripe subscription checkout; `trial_status=converted` on `invoice.paid` |
| Minutes accounting | Single path: `applyUsage()` + `usage_events` (no duplicate trial counter column) |

## Demo vs provider (isolation)

| World | Who | Number / agent | Data |
|-------|-----|----------------|------|
| **Demo** | Landing visitors | Shared Somo Twilio + Retell | `dodgecall_demo_requests` |
| **Provider** | Paying / trial customers | Dedicated per `customers` row | `customers`, portal call logs |

Nothing from demo carries over automatically. Signup bridge tracks `utm_source=dodgecall` for onboarding copy only.

## Feature flags

| Env | Purpose |
|-----|---------|
| `TRIAL_SIM_FLOW_ENABLED=1` | Enable SIM trial path |
| `TRIAL_SIM_LAUNCH_AT` | ISO timestamp; only customers `created_at >=` this date get SIM flow (unless internal override) |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify v2 service |

Rollback: set `TRIAL_SIM_FLOW_ENABLED=0` — signup reverts to plan-first redirect; expiry cron still releases expired trials.

## Data model (`customers`)

- `trial_status`: `none` \| `active` \| `exhausted` \| `expired` \| `converted`
- `trial_started_at`, `trial_expires_at`, `trial_phone_verified_at`
- `trial_last_activity_at`, `trial_release_reason`
- `phone_verified`, `phone_verified_at`
- `signup_attribution_json` (utm_source, etc.)
- `trial_welcome_dismissed_at`

Trial minutes consumed = sum `usage_events.minutes_applied` where `created_at >= trial_started_at`.

## Gating matrix (`billing-access.js`)

| Condition | Inbound |
|-----------|---------|
| `subscription_status=active` | Allow |
| `billing_enforcement_paused=1` | Allow |
| SIM trial active + minutes > 0 + not past `trial_expires_at` | Allow |
| Trial exhausted or expired | Block — trial paused TwiML |
| Subscription suspended / canceled (past grace) | Block — subscription TwiML |
| No minutes (pack-only) | Block |

## Provisioning

`startTrialTenant()` (idempotent):

1. Set trial timestamps and `trial_status=active`
2. `allocateFreeCredits(60)`
3. Create Retell agent if missing
4. Provision Twilio number if missing (`/voice/incoming?customer_id=`)

Paid conversion: `convertTrialToPaid()` on subscription — number retained.

## Cron

`npm run trial:expiry-sweep` — `scripts/trial-expiry-sweep.cjs`

- Job A: `trial_expires_at < now` and not subscribed → release number
- Job B: `trial_last_activity_at` older than 21 days and not subscribed → release

Use `--dry-run` before production provisioning.

## Code map

| File | Role |
|------|------|
| `services/trial-lifecycle.js` | Trial orchestration |
| `services/trial-alerts.js` | SMS + email nudges |
| `services/twilio-verify-service.js` | Phone OTP |
| `services/billing-access.js` | Ingress + provision gates |
| `scripts/trial-expiry-sweep.cjs` | Expiry / inactivity release |
| `routes/signup.js` | Phone verify + attribution |
