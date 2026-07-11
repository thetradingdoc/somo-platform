# Canonical documentation map

**Last updated:** 2026-07-11

Use this table to find the **one** doc to edit per topic. Each folder keeps at most **two** markdown files (`README.md` + one companion); historical merges live under `archive/`. See [`meta/README.md` § Engineering doc hygiene](./README.md#engineering-doc-hygiene).

| Topic | Read first | Companion / depth |
|-------|------------|-------------------|
| **Production execution (SSOT)** | [`plans/CURSOR_PRODUCTION_PLAN.md`](../plans/CURSOR_PRODUCTION_PLAN.md) | [`PRODUCTION_PLAN_LOG.md`](../../PRODUCTION_PLAN_LOG.md), [`plans/somo-backlog.csv`](../plans/somo-backlog.csv) |
| **Open engineering work** | [`todos/PENDING.md`](../../todos/PENDING.md) | [`CUSTOMER_READY_BACKLOG.md`](../CUSTOMER_READY_BACKLOG.md) (archived CR index only) |
| **NYC front desk (active pilot)** | [`architecture/LIVE.md`](../architecture/LIVE.md) | [`voice-agent/unblocked-phases-ops.md`](../voice-agent/unblocked-phases-ops.md) |
| **Healthcare financial agent (deferred)** | [`architecture/HEALTH_SESSION_ARCHITECTURE.md`](../architecture/HEALTH_SESSION_ARCHITECTURE.md) | [`product/VIDEO_HEALTH.md`](../product/VIDEO_HEALTH.md) — Phase 9 deferred |
| **Repo overview** | Root [`README.md`](../../README.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | [`docs/README.md`](../README.md) |
| **Deploy / live verify** | [`deployment/OPERATIONS.md`](../deployment/OPERATIONS.md) | [`deployment/README.md`](../deployment/README.md) (pointer only) |
| **Cutover / incidents** | [`runbooks/OPERATIONS.md`](../runbooks/OPERATIONS.md) | [`runbooks/README.md`](../runbooks/README.md) (pointer only) |
| **Retell agent contract** | [`voice/VOICE_RETELL_AGENT_CONTRACT.md`](../voice/VOICE_RETELL_AGENT_CONTRACT.md) | [`deployment/retell-agent-inventory.json`](../deployment/retell-agent-inventory.json), `npm run verify:agent-config` |
| **Retell agent inventory** | [`deployment/OPERATIONS.md`](../deployment/OPERATIONS.md#retell-agent-inventory) | [`retell-agent-inventory.json`](../deployment/retell-agent-inventory.json) |
| **Architecture snapshot** | [`architecture/PLATFORM_SNAPSHOT.md`](../architecture/PLATFORM_SNAPSHOT.md) | [`architecture/LIVE.md`](../architecture/LIVE.md) (route depth), [`reviews/SOLUTION_ARCHITECTURE_REPORT.md`](../reviews/SOLUTION_ARCHITECTURE_REPORT.md) (deep dive) |
| **Full solution architecture** | [`reviews/SOLUTION_ARCHITECTURE_REPORT.md`](../reviews/SOLUTION_ARCHITECTURE_REPORT.md) | [`architecture/PLATFORM_SNAPSHOT.md`](../architecture/PLATFORM_SNAPSHOT.md), [`reviews/CODEBASE_REVIEW_VOICE_MULTILINGUAL.md`](../reviews/CODEBASE_REVIEW_VOICE_MULTILINGUAL.md) |
| **Medical coding** | [`Medical Coding/README.md`](../Medical%20Coding/README.md) | [`KELLY_CODING_MASTER_EXECUTION_PLAN.md`](../Medical%20Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md), [`ARCHITECTURE.md`](../Medical%20Coding/ARCHITECTURE.md), [`COVERAGE_MATRIX.md`](../Medical%20Coding/COVERAGE_MATRIX.md), [`KELLY_F09_GOVERNANCE.md`](../clinical/KELLY_F09_GOVERNANCE.md) |
| **Prod DB / codebook parity** | [`deployment/PROD_DB_PARITY.md`](../deployment/PROD_DB_PARITY.md) | [`Medical Coding/OPERATIONS.md`](../Medical%20Coding/OPERATIONS.md) § GCS |
| **Coding spine outage** | [`runbooks/CODING_SPINE_OUTAGE.md`](../runbooks/CODING_SPINE_OUTAGE.md) | [`Medical Coding/OPERATIONS.md`](../Medical%20Coding/OPERATIONS.md) |
| **Platform +363 deploy** | [`deployment/PLATFORM_SALES_363_DEPLOY.md`](../deployment/PLATFORM_SALES_363_DEPLOY.md) | [`voice/VOICE_ROUTING_SSOT.md`](../voice/VOICE_ROUTING_SSOT.md) |
| **Post-epic copay (P0.5)** | [`todos/PENDING.md`](../../todos/PENDING.md#p05--post-epic-copay-gaps) | `payer-class-routing.js`, `coding-deferral-copy.json`, `import-plan-rules-benefits.cjs` |
| **Routes & call paths** | [`architecture/LIVE.md`](../architecture/LIVE.md#runtime-entrypoints-and-route-ownership) | [`middleware-platform/server.js`](../../middleware-platform/server.js) |
| **Environment variables** | [`setup/README.md`](../setup/README.md) | Former `ENVIRONMENT_VARIABLES_BY_SURFACE` merged into setup README |
| **Brand / logo / email HTML** | [`Brand/SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md) | [`Brand/README.md`](../Brand/README.md) |
| **Provider portal shell** | [`design/PROVIDER_PORTAL_SHELL.md`](../design/PROVIDER_PORTAL_SHELL.md) | [`design/PROVIDER_TODAY_PAGE.md`](../design/PROVIDER_TODAY_PAGE.md) |
| **Provider calendar** | [`design/PROVIDER_CALENDAR.md`](../design/PROVIDER_CALENDAR.md) | `business/calendar.html` (not `schedule.html`) |
| **Provider Today UI** | [`design/PROVIDER_TODAY_PAGE.md`](../design/PROVIDER_TODAY_PAGE.md) | [`todos/PENDING.md`](../../todos/PENDING.md) |
| **Staging profile** | [`meta/README.md`](./README.md#staging-profile) | [`testing/README.md`](../testing/README.md) |
| **Kelly orchestration** | [`architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md`](../architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md) | [`STATE_OWNERSHIP.md`](../architecture/STATE_OWNERSHIP.md) |
| **Kelly agentic rails** | [`architecture/LIVE.md`](../architecture/LIVE.md#kelly-agentic-rails-target-and-build-plan) | `middleware-platform/services/kelly-rails/` |
| **Conversation mode rails** | [`conversation/CONVERSATION_MODE_MATRIX.md`](../conversation/CONVERSATION_MODE_MATRIX.md) | [`runbooks/CONVERSATION_MODE_ROLLOUT.md`](../runbooks/CONVERSATION_MODE_ROLLOUT.md) |
| **Kelly front-desk UX** | [`product/KELLY_FRONT_DESK_UX.md`](../product/KELLY_FRONT_DESK_UX.md) | [`design/PROVIDER_PORTAL_SHELL.md`](../design/PROVIDER_PORTAL_SHELL.md) |
| **Voice routing** | [`voice/VOICE_ROUTING_SSOT.md`](../voice/VOICE_ROUTING_SSOT.md) | [`voice/PLATFORM_NUMBER_INBOUND_SPEC.md`](../voice/PLATFORM_NUMBER_INBOUND_SPEC.md) |
| **Front-desk deploy** | [`deployment/FRONT_DESK_PRODUCTION.md`](../deployment/FRONT_DESK_PRODUCTION.md) | [`PHASE0_DEPLOY_STATE.md`](../deployment/PHASE0_DEPLOY_STATE.md) |
| **Tenant portal E2E** | [`qa/portal-e2e-compliance.md`](../qa/portal-e2e-compliance.md) | `e2e/dentist-journey-parity.spec.cjs` |
| **Database** | [`Database/README.md`](../Database/README.md) | [`Database/OPERATIONS.md`](../Database/OPERATIONS.md) |
| **Middleware depth** | [`architecture/MIDDLEWARE_PLATFORM.md`](../architecture/MIDDLEWARE_PLATFORM.md) | [`middleware-platform/README.md`](../middleware-platform/README.md) (pointer) |
| **PHI / HIPAA compliance** | [`compliance/README.md`](../compliance/README.md) | [`compliance/PHI_ENCRYPTION_AT_REST.md`](../compliance/PHI_ENCRYPTION_AT_REST.md), [`compliance/VENDOR_BAA_TRACKER.md`](../compliance/VENDOR_BAA_TRACKER.md) |
| **Tenant offboarding** | [`runbooks/TENANT_OFFBOARDING.md`](../runbooks/TENANT_OFFBOARDING.md) | `GET /api/admin/tenants/:clinicId/phi-export` |
| **Admin operator CRM** | [`admin-portal/README.md`](../admin-portal/README.md) | `unified-dashboard/admin/` |
| **Testing / E2E** | [`testing/README.md`](../testing/README.md) | Playwright scripts in `middleware-platform/package.json` |

## Archived narratives (not active SSOT)

- **Folder merges:** `docs/*/archive/CONSOLIDATED-HISTORICAL.md` — searchable archaeology only
- DocLittle / LittleLab / Skin & Care — retired consumer surfaces (Gate G4)
- Commerce PSTN replay — [`qa/archive/commerce-pstn/`](../qa/archive/commerce-pstn/) — DELETE LATER actioned 2026-07-05
- Cursor-local plan files (`~/.cursor/plans/`) — superseded by [`docs/plans/`](../plans/)
