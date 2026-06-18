# Canonical documentation map

**Last updated:** 2026-06-17

Use this table to find the **one** doc to edit per topic. Each folder keeps at most **two** markdown files (`README.md` + one companion); see [`meta/README.md` § Engineering doc hygiene](./README.md#engineering-doc-hygiene).

| Topic | Read first | Companion / depth |
|-------|------------|-------------------|
| **Repo overview** | Root [`README.md`](../../README.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | [`docs/README.md`](../README.md) |
| **Deploy / CI / GCP (live)** | [`runbooks/OPERATIONS.md`](../runbooks/OPERATIONS.md#callsomo-gcp-cutover) | [`deployment/OPERATIONS.md`](../deployment/OPERATIONS.md), [`deployment/README.md`](../deployment/README.md) (historical) |
| **Retell agent inventory** | [`deployment/OPERATIONS.md`](../deployment/OPERATIONS.md#retell-agent-inventory) + [`retell-agent-inventory.json`](../deployment/retell-agent-inventory.json) | `npm run verify:agent-config` |
| **Architecture snapshot** | [`architecture/LIVE.md`](../architecture/LIVE.md#current-state-architecture) | [`architecture/README.md`](../architecture/README.md) (archive TOC only) |
| **Routes & call paths** | [`architecture/LIVE.md`](../architecture/LIVE.md#runtime-entrypoints-and-route-ownership) | [`middleware-platform/server.js`](../../middleware-platform/server.js) |
| **Environment variables** | [`setup/README.md`](../setup/README.md) | Former `ENVIRONMENT_VARIABLES_BY_SURFACE` merged into setup README |
| **Brand / logo / email HTML** | [`Brand/SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md) | [`Brand/README.md`](../Brand/README.md) |
| **Provider portal shell** | [`design/PROVIDER_PORTAL_SHELL.md`](../design/PROVIDER_PORTAL_SHELL.md) | [`design/PROVIDER_TODAY_PAGE.md`](../design/PROVIDER_TODAY_PAGE.md) (Today layout) |
| **Provider calendar** | [`design/PROVIDER_CALENDAR.md`](../design/PROVIDER_CALENDAR.md) | Board + FullCalendar views in `business/calendar.html` |
| **Provider Today UI** | [`design/PROVIDER_TODAY_PAGE.md`](../design/PROVIDER_TODAY_PAGE.md) | [`todos/PENDING.md`](../../todos/PENDING.md) (UI polish section) |
| **Staging profile** | [`meta/README.md`](./README.md#staging-profile) | [`testing/README.md`](../testing/README.md) |
| **Somo demo (landing outbound)** | [`agent/somo-demo/RUNBOOK.md`](../agent/somo-demo/RUNBOOK.md#phase-a-go-recovery-runbook) | [`agent/somo-demo/README.md`](../agent/somo-demo/README.md) |
| **Kelly agentic orchestration** | [`architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md`](../architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md) | [`ORCHESTRATION_GAP_MATRIX.md`](../architecture/ORCHESTRATION_GAP_MATRIX.md), [`TURN_COMPLETION_CONTRACT.md`](../architecture/TURN_COMPLETION_CONTRACT.md) |
| **Kelly agentic rails** | [`architecture/LIVE.md`](../architecture/LIVE.md#kelly-agentic-rails-target-and-build-plan) | [`kelly-rails/`](../../middleware-platform/services/kelly-rails/) in code |
| **Conversation mode rails** | [`conversation/CONVERSATION_MODE_MATRIX.md`](../conversation/CONVERSATION_MODE_MATRIX.md) | [`runbooks/CONVERSATION_MODE_ROLLOUT.md`](../runbooks/CONVERSATION_MODE_ROLLOUT.md), `services/conversation-mode/*` |
| **Kelly front-desk UX** | [`product/KELLY_FRONT_DESK_UX.md`](../product/KELLY_FRONT_DESK_UX.md) | [`design/PROVIDER_PORTAL_SHELL.md`](../design/PROVIDER_PORTAL_SHELL.md), `call-opener-resolver.js` |
| **Tenant portal audit** | [`testing/TESTING.md`](../testing/TESTING.md#tenant-front-desk-audit) | `e2e/tenant-front-desk-audit.spec.cjs`, `test-results/tenant-front-desk-audit.md` |
| **Kelly Phase C (language + voice)** | [`runbooks/KELLY_PHASE_C_STAGING.md`](../runbooks/KELLY_PHASE_C_STAGING.md) | [`DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md`](../agent/kelly-rails/DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md), [`todos/PENDING.md`](../../todos/PENDING.md) (Phase C section) |
| **Payor / provider search** | [`Payor/README.md`](../Payor/README.md) | [`Payor/OPERATIONS.md`](../Payor/OPERATIONS.md) |
| **RCM** | [`RCM/README.md`](../RCM/README.md) | [`RCM/ARCHITECTURE.md`](../RCM/ARCHITECTURE.md) |
| **Database** | [`Database/README.md`](../Database/README.md) | [`Database/OPERATIONS.md`](../Database/OPERATIONS.md) |
| **Patient timeline APIs** | [`architecture/LIVE.md`](../architecture/LIVE.md#patient-timeline-routine-and-billing) | Legacy consumer app code in `patient-app/` (coexisting; not front-desk SSOT) |
| **Medical coding** | [`Medical Coding/ARCHITECTURE.md`](../Medical%20Coding/ARCHITECTURE.md) | [`Medical Coding/README.md`](../Medical%20Coding/README.md) |
| **Voice prompts (runtime paths)** | [`voice-agent/README.md`](../voice-agent/README.md) | `voice-agent/prompts/*.md` (loaded by `configure-retell.js`; exempt from 2-file rule) |
| **Middleware depth** | [`middleware-platform/README.md`](../middleware-platform/README.md) | TOC anchors — do not duplicate |
| **Admin operator CRM** | [`admin-portal/README.md`](../admin-portal/README.md) | Scrape/enrich APIs, HITL gates, `unified-dashboard/admin/` |
| **Testing / E2E** | [`testing/README.md`](../testing/README.md) | Playwright scripts in `middleware-platform/package.json` |
| **Active work** | [`todos/PENDING.md`](../../todos/PENDING.md) | [`CUSTOMER_READY_BACKLOG.md`](../CUSTOMER_READY_BACKLOG.md) (CR/FE detail) |
| **Customer-ready gates** | [`CUSTOMER_READY_BACKLOG.md`](../CUSTOMER_READY_BACKLOG.md) | [`docs/deployment/OPERATIONS.md`](../deployment/OPERATIONS.md) |

## Middleware consolidated README

Kelly, checkout, Retell, and LangGraph depth: [`docs/middleware-platform/README.md`](../middleware-platform/README.md). Consumer naming: [`Brand/SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md).
