#!/usr/bin/env bash
# Split local coding + quality work into stacked PR branches (plan-aligned).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STASH="${1:-wip/all-local-backup}"
if ! git rev-parse --verify "$STASH" >/dev/null 2>&1; then
  echo "Missing backup ref $STASH"
  exit 1
fi

restore() {
  git checkout "$STASH" -- "$@"
}

commit_msg() {
  git commit -m "$(cat <<EOF
$1
EOF
)"
}

# --- PR foundation: coding spine production ---
git checkout main
git checkout -B feat/coding-spine-foundation

restore \
  "docs/Medical Coding/VOICE_CODING_SPINE.md" \
  "docs/Medical Coding/ARCHITECTURE.md" \
  "docs/voice-agent/prompts/kelly-voice-agent-prompt.md" \
  "Knowledge/RAG/icd10_term_corrections.json" \
  "Knowledge/rules/code-pair-validation.json" \
  "Knowledge/ICD-10-PCS" \
  "Knowledge/billing" \
  "middleware-platform/config/coding-thresholds.js" \
  "middleware-platform/migrations/078_triage_rag_primary_cpt.js" \
  "middleware-platform/migrations/079_plan_rules.js" \
  "middleware-platform/migrations/080_quote_audit.js" \
  "middleware-platform/migrations/081_seeded_for_harness.js" \
  "middleware-platform/migrations/082_coding_provenance_json.js" \
  "middleware-platform/migrations/083_icd10_pcs_codes.js" \
  "middleware-platform/migrations/084_coding_decisions_hitl.js" \
  "middleware-platform/services/resolve-insurance-codes.js" \
  "middleware-platform/services/coding-review-service.js" \
  "middleware-platform/services/coding-hitl-resume.js" \
  "middleware-platform/services/journey-gates-service.js" \
  "middleware-platform/services/payer-quote-service.js" \
  "middleware-platform/services/preventive-visit-spine.js" \
  "middleware-platform/services/visit-codes-service.js" \
  "middleware-platform/seeds/pilot-payer-rules.js" \
  "middleware-platform/__tests__/coding-layer-leaks.test.js" \
  "middleware-platform/__tests__/collect-insurance-http-spine.test.js" \
  "middleware-platform/__tests__/collect-insurance-spine.test.js" \
  "middleware-platform/__tests__/journey-gates.test.js" \
  "middleware-platform/__tests__/journey-gates-negative.test.js" \
  "middleware-platform/__tests__/payer-quote-service.test.js" \
  "middleware-platform/__tests__/visit-codes-parity.test.js" \
  "unified-dashboard/admin/coding-reviews.html" \
  "middleware-platform/.env.example" \
  "middleware-platform/.env.staging.example" \
  "middleware-platform/package.json" \
  "middleware-platform/database.js" \
  "middleware-platform/database/connection.js" \
  "middleware-platform/database/repositories/medical-codes.js" \
  "middleware-platform/routes/admin-platform.js" \
  "middleware-platform/routes/voice-appointments.js" \
  "middleware-platform/services/coding-orchestrator.js" \
  "middleware-platform/services/kelly-agent-service.js" \
  "middleware-platform/services/kelly-rails/execute-turn.js" \
  "middleware-platform/services/kelly-rails/gates/opqrst.js" \
  "middleware-platform/services/kelly-rails/hydrate.js" \
  "middleware-platform/services/kelly-rails/state-schema.js" \
  "middleware-platform/services/kelly-rails/tool-allowlists.js" \
  "middleware-platform/services/kelly-tool-executor.js" \
  "middleware-platform/services/knowledge-service.js" \
  "middleware-platform/services/layer2-rag/pinecone-code-metadata-client.js" \
  "middleware-platform/services/layer2-rag/remote-rag-client.js" \
  "middleware-platform/services/patient-orchestrator-service.js" \
  "middleware-platform/services/pinecone-rest.js" \
  "middleware-platform/services/triage-rag-fast-complete.js" \
  "middleware-platform/services/triage-rag-service-v2.js" \
  "middleware-platform/services/triage-rag-service.js" \
  "middleware-platform/services/voice-triage-guards.js" \
  "middleware-platform/utils/cpt-helper.js" \
  "middleware-platform/webhooks/retell-websocket.js" \
  "middleware-platform/scripts/generate-cloudrun-env-yaml.cjs" \
  "middleware-platform/scripts/data/populate-code-embeddings.js" \
  "middleware-platform/scripts/data/import-billing-reference-codes.js" \
  "middleware-platform/scripts/data/import-icd10-pcs-codes.js" \
  "middleware-platform/scripts/harness/capture-coding-prod-evidence.cjs" \
  "middleware-platform/scripts/harness/capture-paul-demo-evidence.cjs" \
  "middleware-platform/scripts/harness/capture-phase1-evidence.cjs" \
  "middleware-platform/scripts/harness/capture-session1-voice-evidence.cjs" \
  "middleware-platform/scripts/harness/capture-sessions4567-evidence.cjs" \
  "middleware-platform/scripts/archive-legacy-dev-db.cjs" \
  "middleware-platform/scripts/verify/verify-codebook-parity.js" \
  "middleware-platform/scripts/verify/verify-coding-hitl.cjs" \
  "middleware-platform/scripts/verify/verify-cpt-routing.cjs" \
  "middleware-platform/scripts/verify/verify-db-path.cjs" \
  "middleware-platform/scripts/verify/verify-kelly-tools.cjs" \
  "middleware-platform/scripts/verify/verify-live-spine.cjs" \
  "middleware-platform/scripts/verify/verify-no-hardcoded-coding.cjs" \
  "middleware-platform/scripts/verify/verify-pair-validation.cjs" \
  "middleware-platform/scripts/verify/verify-payer-model.cjs" \
  "middleware-platform/scripts/verify/verify-quote-eligibility-chain.cjs" \
  "middleware-platform/scripts/verify/verify-session1-paths.cjs" \
  "middleware-platform/scripts/verify/verify-session1-staging.cjs" \
  "middleware-platform/scripts/verify/verify-session1-triage-evidence.cjs" \
  "middleware-platform/scripts/verify/verify-threshold-ssot.cjs" \
  "middleware-platform/scripts/verify/verify-triage-spine.cjs" \
  "middleware-platform/scripts/harness/phase1-live-call-runner.cjs" \
  "middleware-platform/scripts/harness/session1-closeout.cjs" \
  "middleware-platform/scripts/harness/session1-spine-harness.cjs" \
  "middleware-platform/scripts/harness/session2-codebook-harness.cjs" \
  "middleware-platform/scripts/harness/session3-insurance-spine-harness.cjs" \
  "middleware-platform/scripts/harness/session4-kelly-quote-evidence.cjs" \
  "middleware-platform/scripts/harness/session4-quote-harness.cjs" \
  "middleware-platform/scripts/harness/session5-gates-harness.cjs" \
  "middleware-platform/scripts/simulate_paul_journey.js" \
  "middleware-platform/scripts/lib/paul-harness-seed.js" \
  "scripts/ci-local.sh" \
  "scripts/deploy-to-gcp.sh"

git add -A
commit_msg "feat(coding): voice Kelly coding spine — resolver, HITL, quote chain, CI gates

Production coding orchestration: migrations 078–084, resolveInsuranceCodes SSOT,
HITL queue, payer quote, preventive spine, Kelly tools, Pinecone spine, verify harnesses."

# --- PR0: reviewer docs (parallel to foundation) ---
git checkout main
git checkout -B refactor/pr0-coding-review-guide
restore "docs/Medical Coding/CODING_LAYER_REVIEW.md"
git add "docs/Medical Coding/CODING_LAYER_REVIEW.md"
commit_msg "docs(coding): add CODING_LAYER_REVIEW guide for PR reviewers

File map, invariants checklist, test matrix, and refactor boundaries for voice coding spine PRs."

# --- PR2: verify foundation libs ---
git checkout feat/coding-spine-foundation
git checkout -B refactor/pr2-verify-foundation
restore \
  "middleware-platform/scripts/lib/verify-env.cjs" \
  "middleware-platform/scripts/lib/verify-args.cjs" \
  "middleware-platform/scripts/lib/verify-assert.cjs" \
  "middleware-platform/scripts/lib/verify-migrations.cjs" \
  "middleware-platform/scripts/verify/verify-routine-path.cjs" \
  "middleware-platform/scripts/verify/verify-voice-http-spine.cjs"
git add middleware-platform/scripts/lib/verify-env.cjs \
  middleware-platform/scripts/lib/verify-args.cjs \
  middleware-platform/scripts/lib/verify-assert.cjs \
  middleware-platform/scripts/lib/verify-migrations.cjs \
  middleware-platform/scripts/verify/verify-routine-path.cjs \
  middleware-platform/scripts/verify/verify-voice-http-spine.cjs
commit_msg "refactor(verify): add shared verify-env, args, assert, migrations libs

Canonical DB_PATH for verify scripts; migrate routine-path and voice-http-spine."

# --- PR3: seed + Kelly test harness ---
git checkout refactor/pr2-verify-foundation
git checkout -B refactor/pr3-seed-harness
restore \
  "middleware-platform/scripts/lib/seed-triage.cjs" \
  "middleware-platform/scripts/lib/seed-payer-rules.cjs" \
  "middleware-platform/scripts/lib/kelly-test-harness.cjs" \
  "middleware-platform/scripts/verify/verify-kelly-http-collect.cjs"
git add middleware-platform/scripts/lib/seed-triage.cjs \
  middleware-platform/scripts/lib/seed-payer-rules.cjs \
  middleware-platform/scripts/lib/kelly-test-harness.cjs \
  middleware-platform/scripts/verify/verify-kelly-http-collect.cjs
commit_msg "refactor(verify): consolidate seed-triage and Kelly _post test harness

Single seedTriage helper and withMockPost for collect_insurance HTTP contract tests."

# --- PR4: verify DB unification ---
git checkout refactor/pr3-seed-harness
git checkout -B refactor/pr4-verify-db
restore \
  "middleware-platform/scripts/lib/verify-db.cjs" \
  "middleware-platform/scripts/verify/verify-live-shared.cjs"
git add middleware-platform/scripts/lib/verify-db.cjs \
  middleware-platform/scripts/verify/verify-live-shared.cjs
commit_msg "refactor(verify): unify DB access for live-call and integration scripts

Add verify-db.cjs; align verify-live-shared with canonical DB path."

# --- PR5: coding spine post-call checks ---
git checkout refactor/pr4-verify-db
git checkout -B refactor/pr5-spine-checks
restore \
  "middleware-platform/scripts/lib/coding-spine-checks.cjs" \
  "middleware-platform/scripts/verify/verify-live-call.cjs" \
  "middleware-platform/scripts/verify/verify-terminal-call.cjs" \
  "middleware-platform/scripts/terminal-coding-call.cjs"
git add middleware-platform/scripts/lib/coding-spine-checks.cjs \
  middleware-platform/scripts/verify/verify-live-call.cjs \
  middleware-platform/scripts/verify/verify-terminal-call.cjs \
  middleware-platform/scripts/terminal-coding-call.cjs
commit_msg "refactor(verify): extract coding-spine-checks for live and terminal verifiers

Fix verify drift between terminal-coding-call and standalone post-call scripts."

# --- PR6: deploy readiness dedup ---
git checkout refactor/pr5-spine-checks
git checkout -B refactor/pr6-deploy-dedup
restore \
  "middleware-platform/scripts/lib/deploy-readiness.cjs" \
  "middleware-platform/scripts/verify/verify-staging-coding-deploy.cjs" \
  "middleware-platform/scripts/verify/verify-ops-live-call-readiness.cjs"
git add middleware-platform/scripts/lib/deploy-readiness.cjs \
  middleware-platform/scripts/verify/verify-staging-coding-deploy.cjs \
  middleware-platform/scripts/verify/verify-ops-live-call-readiness.cjs
commit_msg "refactor(verify): shared deploy-readiness checks for staging and ops scripts"

# --- PR8+9: Kelly module extraction (PR7 gates already in foundation kelly file) ---
git checkout refactor/pr6-deploy-dedup
git checkout -B refactor/pr8-kelly-modules
restore \
  "middleware-platform/services/kelly-tool-executor/collect-insurance.js" \
  "middleware-platform/services/kelly-tool-executor/http-client.js" \
  "middleware-platform/services/kelly-tool-executor/checkout-context.js" \
  "middleware-platform/services/kelly-tool-executor/triage-tools.js" \
  "middleware-platform/services/kelly-tool-executor/commerce-tools.js" \
  "middleware-platform/services/kelly-tool-executor.js"
git add middleware-platform/services/kelly-tool-executor/ \
  middleware-platform/services/kelly-tool-executor.js
commit_msg "refactor(kelly): extract collect-insurance, http-client, checkout-context modules

Delegate _collectInsurance and _post to kelly-tool-executor/*; shrink god file."

# --- PR10+11: voice insurance spine + route boundaries ---
git checkout refactor/pr8-kelly-modules
git checkout -B refactor/pr10-voice-insurance-routes
restore \
  "middleware-platform/services/voice-insurance-spine-handler.js" \
  "middleware-platform/routes/voice/insurance-routes.js" \
  "middleware-platform/routes/voice/checkout-routes.js" \
  "middleware-platform/routes/voice/appointment-routes.js" \
  "middleware-platform/routes/voice-appointments.js"
git add middleware-platform/services/voice-insurance-spine-handler.js \
  middleware-platform/routes/voice/ \
  middleware-platform/routes/voice-appointments.js
commit_msg "refactor(voice): insurance spine handler and route domain boundaries

Dedupe resolveInsuranceCodes HTTP mapping; register voice route modules."

# --- PR13: database transitions extract ---
git checkout refactor/pr10-voice-insurance-routes
git checkout -B refactor/pr13-database-transitions
restore \
  "middleware-platform/database/transitions.js" \
  "middleware-platform/database/postgres-sync.js" \
  "middleware-platform/database.js"
git add middleware-platform/database/transitions.js \
  middleware-platform/database/postgres-sync.js \
  middleware-platform/database.js
commit_msg "refactor(database): extract status transition FSM to database/transitions.js

Start incremental database.js modularization; postgres-sync placeholder module."

echo "Done. Branches created. Backup ref: refs/backup/pre-split-all -> $STASH"
git branch --list 'feat/coding-spine-foundation' 'refactor/pr*'
