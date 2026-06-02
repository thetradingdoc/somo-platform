# Somo Demo Production Gap Backlog

Last updated: 2026-06-02 (Phase A route closure — **GO**; `api.callsomo.com` → `somo-middleware`)  
Source report: `docs/agent/somo-demo/PROD_E2E_EXECUTION_REPORT_2026-06-02.md`  
Execution runbook: `docs/agent/somo-demo/PHASE_A_GO_RECOVERY_RUNBOOK.md`  
Deploy SSOT: `docs/deployment/SOMO_CLOUD_RUN_DEPLOY.md`

## P0 (Blockers)

1. ~~**Canonical prod route mismatch**~~ **RESOLVED (2026-06-02)**
   - Evidence: `curl https://api.callsomo.com/api/public/somo-demo/health` → **200** `{"ok":true,"demo_enabled":true}`
   - `npm run verify:prod:routing-smoke` → **PASS**
   - Deploy revision: `somo-middleware-00002-zrj` (domain `api.callsomo.com` → `somo-middleware`, 2026-06-02)
   - Legacy `/api/public/dodgecall/*` routes removed from codebase; alias no longer required.

2. ~~**Prod smoke failing on canonical route**~~ **RESOLVED (2026-06-02)**
   - `npm run test:prod:smoke` → **2/2 passed** (canonical health + consent error code)
   - `playwright.prod.config.cjs` in use.

3. **No Google Sheets outbound telemetry sink** — **OPEN (Phase B)**
   - Symptom: no Sheets writer in demo call path.
   - Impact: cannot satisfy required structured sales analytics.
   - Target files:
     - `middleware-platform/services/somo-demo-service.js`
     - `middleware-platform/webhooks/somo-demo-handler.js`
     - `middleware-platform/services/somo-demo-sheets-sync.js`
   - Acceptance:
     - EventLog append + LeadStatus upsert
     - idempotency, retry, and DLQ behavior documented and verified.

## P1 (High priority)

1. **Duplicate phone throttling ineffective in prod flow**
   - Symptom: repeated submissions with same phone succeeded in same run (pre-fix matrix).
   - Impact: uncontrolled repeat calls to same prospect.
   - Target files:
     - `middleware-platform/services/somo-demo-service.js`
     - related DB accessors in `middleware-platform/database.js`
  - Current status:
    - DB-backed rolling 24h lock semantics implemented in repo.
    - Re-verify on deployed production host (see Phase A runbook step 5).
  - Acceptance:
    - second request for same phone inside policy window returns `429` with `error_code=DUPLICATE_PHONE_WINDOW`.

2. **Qualification fields not persisted**
   - Symptom: extended fields (`language`, `country`, `city`, `practice_specialty`, `practice_size`, `questions_asked`) accepted by payload but persistence/export not verifiable.
   - Impact: sales reporting and segmentation incomplete.
   - Target files:
     - `middleware-platform/services/somo-demo-service.js`
     - schema migration for `somo_demo_requests` (or child table)
   - Acceptance:
     - fields persisted and visible in execution report evidence.

3. **No authoritative scenario runner for outbound sales**
   - Symptom: scenario matrix run required ad-hoc shell script.
   - Impact: inconsistent reproducibility and regression confidence.
   - Target files:
     - new `middleware-platform/scripts/e2e-somo-demo-prod-matrix.cjs`
     - `middleware-platform/package.json`
   - Acceptance:
     - one command executes matrix with structured JSON output.

## P2 (Improvements)

1. **Outcome taxonomy standardization**
   - Add explicit statuses for `qualified_followup`, `not_interested`, `voicemail`, `booked`.

2. **Per-scenario evidence collector**
   - Save request/response, call SID, and post-call transcript summary into `test-results/`.

3. **Ops dashboard alignment**
   - Add panel mappings from `somo_demo_requests` and sheets sync metrics.

## Re-run Closure Criteria

Phase A routing closure (achieved 2026-06-02):

1. Canonical route works in production (`/api/public/somo-demo/*`). **DONE**
2. Prod smoke browser test runs from `npm run test:prod:smoke`. **DONE**
3. Landing assistant turn returns 200 (`/api/public/landing-assistant/turn`). **DONE**

Phase B / full outbound closure (remaining):

3. Duplicate phone guard returns expected 429 behavior (runtime proof).
4. Qualification fields are persisted and exported.
5. EventLog and LeadStatus tabs receive rows for at least 3 live scenarios.
