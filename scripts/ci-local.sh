#!/usr/bin/env bash
# Local CI — replaces GitHub Actions (no billing). Run before push or deploy.
# Usage: ./scripts/ci-local.sh [fast|gate|slow|full]
#   fast / gate — pre-push / pre-deploy (~3 min). Default for deploy.
#   slow        — network / DB-backed coding gates (nightly / pre-release).
#   full        — fast + slow (no Jest / Playwright).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIER="${1:-gate}"
MP="$ROOT/middleware-platform"

_STEP_START=0
step() {
  if [[ "${CI_TIMING:-}" == "1" && "$_STEP_START" -gt 0 ]]; then
    local elapsed=$(( $(date +%s) - _STEP_START ))
    echo "    (${elapsed}s)"
  fi
  echo ""
  echo "==> $*"
  _STEP_START=$(date +%s)
}

case "$TIER" in
  fast|gate|slow|full) ;;
  *)
    echo "Usage: $0 [fast|gate|slow|full]" >&2
    exit 2
    ;;
esac

if [[ "$TIER" == "gate" ]]; then
  TIER="fast"
fi

run_repo_guardrails() {
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
}

run_kelly_env() {
  cd "$MP"
  step "Kelly Rails env + gates"
  npm run verify:kelly-rails-env
  CLOUDRUN_PROFILE=production CONVERSATION_MODE_ROUTING=enforce npm run verify:env-gates
}

run_fast_verify() {
  cd "$MP"
  step "Prod spine imports"
  npm run verify:prod-spine-imports

  step "Server boot smoke"
  npm run verify:server-boot

  step "Legacy path guard"
  npm run verify:no-legacy-paths

  step "OPQRST freeze E2E"
  npm run verify:opqrst-freeze-e2e

  step "Security gate"
  npm run release:security-gate

  step "Voice routing matrix smoke"
  npm run smoke:voice-routing-matrix

  step "Tenant site context"
  npm run verify:tenant-site-context

  step "Voice tenant contract smoke"
  node "$ROOT/scripts/voice-tenant-contract-smoke.cjs"

  step "Hosting bundle verify"
  cd "$ROOT"
  npm ci --prefix "$ROOT/unified-dashboard/somo-landing"
  node scripts/build-staging-hosting.cjs
  node scripts/verify-staging-hosting.cjs
}

run_slow_coding_gates() {
  cd "$MP"

  step "Codebook parity (Session 2 gate)"
  if [[ -f var/db/middleware-dev.db ]]; then
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-codebook-parity.js || {
      echo "⚠️  Codebook parity failed — run Session 2 imports (import-icd10/cpt/hcpcs + embeddings)"
    }
  else
    SKIP_EMBED_CHECK=1 DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-codebook-parity.js || {
      echo "⚠️  Codebook parity skipped — no var/db/middleware-dev.db (Session 2)"
    }
  fi

  step "Phase 1 foundation gates"
  if [[ -f var/db/middleware-dev.db ]]; then
    DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify/verify-db-path.cjs || echo "⚠️  verify-db-path failed"
    node scripts/verify/verify-threshold-ssot.cjs || echo "⚠️  verify-threshold-ssot failed"
  fi

  step "Coding prod gates (slow — network / DB)"
  node scripts/verify/verify-no-hardcoded-coding.cjs || { echo "❌ verify-no-hardcoded-coding failed"; exit 1; }
  node scripts/verify/verify-threshold-ssot.cjs || { echo "❌ verify-threshold-ssot failed"; exit 1; }

  if [[ -f var/db/middleware-dev.db ]]; then
    DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify/verify-db-path.cjs || { echo "❌ verify-db-path failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-kelly-tools.cjs || { echo "❌ verify-kelly-tools failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-kelly-http-collect.cjs || { echo "❌ verify-kelly-http-collect failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-routine-path.cjs || { echo "❌ verify-routine-path failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-voice-http-spine.cjs || { echo "❌ verify-voice-http-spine failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-coding-hitl.cjs || { echo "❌ verify-coding-hitl failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-pair-validation.cjs || { echo "❌ verify-pair-validation failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-quote-eligibility-chain.cjs || { echo "❌ verify-quote-eligibility-chain failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify/verify-cpt-routing.cjs || { echo "❌ verify-cpt-routing failed"; exit 1; }
    DB_PATH=./var/db/middleware-dev.db SKIP_STARTUP_MIGRATIONS=1 node scripts/verify/verify-payer-model.cjs || { echo "❌ verify-payer-model failed"; exit 1; }

    step "Tenant column null preflight"
    node scripts/verify/verify-tenant-columns-null-free.cjs --check-only || {
      echo "❌ tenant column nulls — run: DB_PATH=./var/db/middleware-dev.db node scripts/data/backfill-site-context-tenant-columns.cjs"
      exit 1
    }

    if [[ "${CODING_PROD_CI:-1}" == "1" ]]; then
      DB_PATH=./var/db/middleware-dev.db EVAL_USE_SEMANTIC=false REMOTE_RAG_TIMEOUT_MS="${REMOTE_RAG_TIMEOUT_MS:-8000}" \
        node scripts/verify/verify-live-spine.cjs || { echo "❌ verify-live-spine failed"; exit 1; }
      DB_PATH=./var/db/middleware-dev.db USE_TRIAGE_RAG_V2=1 \
        node scripts/verify/verify-triage-spine.cjs || { echo "❌ verify-triage-spine failed"; exit 1; }
      if [[ -n "${GROQ_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" || -n "${ANTHROPIC_API_KEY:-}" ]]; then
        npm run test:coding:terminal-call || { echo "❌ terminal-coding-call failed"; exit 1; }
      else
        echo "⚠️  Skipping test:coding:terminal-call — set GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY"
      fi
    fi
  else
    echo "ℹ️  DB-backed coding gates skipped (var/db/middleware-dev.db missing)"
  fi
}

run_full_extras() {
  step "Docs route/service parity"
  cd "$ROOT"
  node scripts/check-docs-route-service-parity.cjs
}

case "$TIER" in
  fast)
    run_repo_guardrails
    run_kelly_env
    run_fast_verify
    ;;
  slow)
    run_slow_coding_gates
    ;;
  full)
    run_repo_guardrails
    run_kelly_env
    run_fast_verify
    run_slow_coding_gates
    run_full_extras
    ;;
esac

if [[ "${CI_TIMING:-}" == "1" && "$_STEP_START" -gt 0 ]]; then
  echo "    ($(($(date +%s) - _STEP_START))s)"
fi

echo ""
echo "✅ ci-local ($TIER) passed"
