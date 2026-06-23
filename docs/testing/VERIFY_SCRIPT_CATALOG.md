# Verify script catalog

**Last updated:** 2026-06-22

SSOT for gate policy: [middleware-platform/docs/VERIFY_GATES.md](../../middleware-platform/docs/VERIFY_GATES.md).

Run all fast gates: `npm run ci:fast` (repo root).

## Voice / telephony

- `verify-voice-env.cjs`, `verify-voice-http-spine.cjs`, `verify-voice-tenant-contract.cjs`
- `verify-voice-identity-vars.cjs`, `verify-call-opener-parity.cjs`
- `verify-live-call.cjs`, `verify-live-booking-call.cjs`, `verify-live-cancel-call.cjs`
- `verify-live-reschedule-call.cjs`, `verify-live-copay-call.cjs`, `verify-live-records-call.cjs`
- `verify-live-visit-checkout.cjs`, `verify-terminal-call.cjs`, `verify-live-spine.cjs`
- `verify-asr-low-confidence-monitor.cjs`, `verify-agent-config.cjs`

## Kelly / conversation

- `verify-kelly-rails-env.cjs`, `verify-kelly-rails-cloudrun-env.cjs`, `verify-kelly-rails-prod-runtime-only.cjs`
- `verify-kelly-rails-runtime-event.cjs`, `verify-kelly-http-collect.cjs`, `verify-kelly-tools.cjs`
- `verify-triage-spine.cjs`, `verify-routine-path.cjs`, `verify-emergency-rail-spot.cjs`
- `verify-orchestration-trace-completeness.cjs`, `verify-cpt-routing.cjs`

## Payor / geo

- `verify-payor-vendor-readiness-env.cjs`, `verify-payer-model.cjs`, `verify-geo-release-readiness.cjs`
- `verify-geo-diagnostics-post-ingest.cjs`, `verify-welch-food-route-checklist.cjs`
- `verify-obf-metrics.cjs`, `verify-obf-cache-live.cjs`, `verify-obf-timeout-ux.cjs`, `verify-obf-ingestion-metrics.cjs`

## RCM / billing

- `verify-quote-eligibility-chain.cjs`, `verify-stedi-env.cjs`, `verify-live-copay-call.cjs`

## Clinical / coding

- `verify-coding-hitl.cjs`, `verify-prod-codebook.cjs`, `verify-staging-coding-deploy.cjs`
- `verify-no-hardcoded-coding.cjs`, `verify-fhir-migration.cjs`

## Database / tenant

- `verify-db-path.cjs`, `verify-tenant-site-context.cjs`, `verify-tenant-columns-null-free.cjs`
- `verify-fhir-migration.cjs`, `verify-gcs-sqlite-contention.cjs`

## Ops / env

- `verify-env-gates.cjs`, `verify-performance-budgets.cjs`, `verify-email-provider.cjs`
- `verify-sandbox-telemetry.cjs`, `verify-p0-telemetry.cjs`, `verify-ops-live-call-readiness.cjs`
- `verify-session1-paths.cjs`, `verify-session1-staging.cjs`, `verify-session1-triage-evidence.cjs`

## Spine / layout

- `prod-spine-imports.cjs` — module resolution smoke (`npm test` in middleware-platform)
- `verify-no-legacy-paths.cjs` — banned path strings in active code

Full list: `middleware-platform/scripts/verify/*.cjs` (72 scripts).
