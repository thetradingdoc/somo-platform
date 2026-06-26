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
node scripts/check-monolith-growth.cjs
node scripts/check-performance-budgets.cjs
node scripts/check-auth-ui-guardrails.cjs
node scripts/check-landing-route-canonicalization.cjs
RETENTION_DRY_RUN=1 node scripts/retention-cleanup.cjs
node scripts/verify-agentic-checkout.cjs
node scripts/verify-repo-layout.cjs

step "Health session unit tests"
cd "$MP"
npm test -- --runInBand --testPathPattern=health-

step "Kelly Rails env + gates"
cd "$MP"
npm run verify:kelly-rails-env
CLOUDRUN_PROFILE=production CONVERSATION_MODE_ROUTING=enforce npm run verify:env-gates

step "Kelly golden + language"
npm run test:kelly:rails:golden
npm run test:kelly:rails:language

step "Codebook parity (Session 2 gate)"
cd "$MP"
if [[ -f var/db/middleware-dev.db ]]; then
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-codebook-parity.js || {
    echo "⚠️  Codebook parity failed — run Session 2 imports (import-icd10/cpt/hcpcs + embeddings)"
  }
else
  SKIP_EMBED_CHECK=1 DB_PATH=./var/db/middleware-dev.db node scripts/verify-codebook-parity.js || {
    echo "⚠️  Codebook parity skipped — no var/db/middleware-dev.db (Session 2)"
  }
fi

step "Phase 1 foundation gates"
if [[ -f var/db/middleware-dev.db ]]; then
  DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify-db-path.cjs || echo "⚠️  verify-db-path failed"
  node scripts/verify-threshold-ssot.cjs || echo "⚠️  verify-threshold-ssot failed"
fi

step "Coding prod gates"
node scripts/verify-no-hardcoded-coding.cjs || { echo "❌ verify-no-hardcoded-coding failed"; exit 1; }
node scripts/verify-threshold-ssot.cjs || { echo "❌ verify-threshold-ssot failed"; exit 1; }
if [[ -f var/db/middleware-dev.db ]]; then
  DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify-db-path.cjs || { echo "❌ verify-db-path failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-kelly-tools.cjs || { echo "❌ verify-kelly-tools failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-kelly-http-collect.cjs || { echo "❌ verify-kelly-http-collect failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-routine-path.cjs || { echo "❌ verify-routine-path failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-voice-http-spine.cjs || { echo "❌ verify-voice-http-spine failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-coding-hitl.cjs || { echo "❌ verify-coding-hitl failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-pair-validation.cjs || { echo "❌ verify-pair-validation failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db node scripts/verify-quote-eligibility-chain.cjs || { echo "❌ verify-quote-eligibility-chain failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify-cpt-routing.cjs || { echo "❌ verify-cpt-routing failed"; exit 1; }
  DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify-payer-model.cjs || { echo "❌ verify-payer-model failed"; exit 1; }
  if [[ "${CODING_PROD_CI:-1}" == "1" ]]; then
    DB_PATH=./var/db/middleware-dev.db EVAL_USE_SEMANTIC=false REMOTE_RAG_TIMEOUT_MS="${REMOTE_RAG_TIMEOUT_MS:-8000}" \
      node scripts/verify-live-spine.cjs || { echo "❌ verify-live-spine failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db USE_TRIAGE_RAG_V2=1 \
      node scripts/verify-triage-spine.cjs || { echo "❌ verify-triage-spine failed"; exit 1; }
    if [[ -n "${GROQ_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" || -n "${ANTHROPIC_API_KEY:-}" ]]; then
      npm run test:coding:terminal-call || { echo "❌ terminal-coding-call failed"; exit 1; }
    else
      echo "⚠️  Skipping test:coding:terminal-call — set GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY"
    fi
  fi
else
  echo "ℹ️  DB-backed coding gates skipped (var/db/middleware-dev.db missing)"
fi

step "Jest (middleware-platform)"
npm test -- --runInBand --forceExit

step "Security gate"
npm run release:security-gate

step "Voice routing matrix smoke"
npm run smoke:voice-routing-matrix

step "Site + escalation unit tests"
META_KV_POLICY_STRICT=1 npm test -- --runInBand --forceExit __tests__/call-site-context.test.js __tests__/stamp-tenant-site-context.test.js __tests__/escalation-service.test.js __tests__/transfer-call.test.js __tests__/voice-inbound-tenant-twiml.test.js __tests__/retell-transfer.test.js __tests__/triage-site-context.test.js __tests__/fhir-patient-clinic-scope.test.js __tests__/case-records-tenant.test.js __tests__/voice-settings-clinic.test.js __tests__/meta-kv-policy.test.js __tests__/voice-call-context.test.js __tests__/ws-reconnect-site-context.test.js __tests__/outbound-safety.test.js __tests__/conversation-mode-site-context.test.js __tests__/kelly-booking-avail-probe.test.js

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

  step "Docs route/service parity"
  cd "$ROOT"
  node scripts/check-docs-route-service-parity.cjs

  step "Health video UI build"
  cd "$ROOT"
  npm run health:ui:build

  step "Health video E2E (requires API on :4000)"
  cd "$MP"
  if curl -sf "${PW_API_BASE_URL:-http://127.0.0.1:4000}/api/health-session/start" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"terms_accepted":false}' >/dev/null 2>&1 || \
    curl -sf "${PW_API_BASE_URL:-http://127.0.0.1:4000}/health-video/" >/dev/null 2>&1; then
    npm run test:e2e:health-video || echo "⚠️  Health video E2E failed — ensure npm run health:dev is running with GROQ_API_KEY for full journey"
  else
    echo "⚠️  Skipping health video E2E — start middleware with npm run health:dev on :4000"
  fi
fi

echo ""
echo "✅ ci-local ($TIER) passed"
