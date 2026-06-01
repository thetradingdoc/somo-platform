# Staging environment profile

Single reference for staging flags and ops paths (May 2026).

## Hosts

| Role | URL |
|------|-----|
| UI | `https://myskinandcare.com` (staging) |
| API | `https://api.myskinandcare.com` |

## Required env (Cloud Run / local staging)

| Variable | Purpose |
|----------|---------|
| `SAAS_VOICE_FAIL_CLOSED=1` | SaaS tenant without `retell_agent_id` → TwiML hangup (default on) |
| `POSTGRES_URL` | Preferred ops DB; GCS SQLite is export snapshot only |
| `STRIPE_WEBHOOK_SECRET` | Canonical webhook `POST /webhooks/stripe` only |
| `ALLOW_LEGACY_STRIPE_WEBHOOK` | Must be unset or `0` in staging/prod |

## Preflight

```bash
cd middleware-platform
npm run staging:preflight
npm run billing:test-gate
npm run audit:trial-provision-drift
```

## DB truth

- GCS `middleware-staging.db` may lag live Postgres — see [`docs/Database/SOMO_FOUNDATION_RUNBOOK.md`](Database/SOMO_FOUNDATION_RUNBOOK.md).
- Email OTP: prefer `POSTGRES_URL` or `STAGING_EMAIL_CODE` over stale GCS.

## Feature flags (common)

| Flag | Surface |
|------|---------|
| `CHECKOUT_RAIL_GUARDS_ENABLED` | Kelly commerce stage gates |
| `REQUIRE_COMMERCE_EMAIL_VERIFICATION` | Email OTP before prepare |
| `KellyOrchestratorPhase.orchestratorEnabled()` | Kelly phase FSM |

See also [`docs/testing/STAGING_DIAGNOSTIC_RUNBOOK.md`](testing/STAGING_DIAGNOSTIC_RUNBOOK.md).
