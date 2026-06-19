#!/usr/bin/env bash
# Local CI — replaces GitHub Actions (no billing). Run before push or deploy.
# Usage: ./scripts/ci-local.sh [gate|full]
#   gate  — fast pre-push / pre-deploy (~5–15 min). Default.
#   full  — gate + reasoning regression + landing E2E + hosting build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIER="${1:-gate}"
MP="$ROOT/middleware-platform"

step() { echo ""; echo "==> $*"; }

case "$TIER" in
  gate|full) ;;
  *)
    echo "Usage: $0 [gate|full]" >&2
    exit 2
    ;;
esac

cd "$ROOT"

step "Repo guardrails"
node scripts/guardrail-no-azure-deploy.cjs
node scripts/check-legacy-hosts.cjs
node scripts/check-docs-stale-strings.cjs
node scripts/check-brand-strings.cjs
node scripts/check-brand-consumer-strings.cjs --no-legacy-api-default-env
node scripts/check-performance-budgets.cjs
node scripts/check-auth-ui-guardrails.cjs
node scripts/check-landing-route-canonicalization.cjs
RETENTION_DRY_RUN=1 node scripts/retention-cleanup.cjs
node scripts/verify-agentic-checkout.cjs
node scripts/verify-repo-layout.cjs

step "Kelly Rails env + gates"
cd "$MP"
npm run verify:kelly-rails-env
CLOUDRUN_PROFILE=production CONVERSATION_MODE_ROUTING=enforce npm run verify:env-gates

step "Kelly golden + language"
npm run test:kelly:rails:golden
npm run test:kelly:rails:language

step "Jest (middleware-platform)"
npm test -- --runInBand --forceExit

step "Security gate"
npm run release:security-gate

step "Voice routing matrix smoke"
npm run smoke:voice-routing-matrix

step "Site + escalation unit tests"
META_KV_POLICY_STRICT=1 npm test -- --runInBand --forceExit __tests__/call-site-context.test.js __tests__/escalation-service.test.js __tests__/transfer-call.test.js __tests__/voice-inbound-tenant-twiml.test.js __tests__/retell-unidentified-emergency.test.js __tests__/retell-transfer.test.js __tests__/triage-site-context.test.js __tests__/fhir-patient-clinic-scope.test.js __tests__/case-records-tenant.test.js __tests__/voice-settings-clinic.test.js __tests__/meta-kv-policy.test.js __tests__/voice-call-context.test.js __tests__/ws-reconnect-site-context.test.js __tests__/outbound-safety.test.js __tests__/conversation-mode-site-context.test.js __tests__/kelly-booking-avail-probe.test.js __tests__/somo-demo-handler.test.js

step "Voice tenant contract smoke"
node "$ROOT/scripts/voice-tenant-contract-smoke.cjs"

step "Tenant column null preflight (check-only)"
cd "$MP"
node scripts/verify-tenant-columns-null-free.cjs --check-only || true

step "Hosting bundle verify"
cd "$ROOT"
node scripts/build-staging-hosting.cjs
node scripts/verify-staging-hosting.cjs

if [[ "$TIER" == "full" ]]; then
  step "Reasoning regression"
  cd "$ROOT"
  npm run test:reasoning-regression

  step "Landing E2E (Playwright)"
  cd "$MP"
  npm run test:e2e-somo-landing

  step "Docs route/service parity"
  cd "$ROOT"
  node scripts/check-docs-route-service-parity.cjs
fi

echo ""
echo "✅ ci-local ($TIER) passed"
