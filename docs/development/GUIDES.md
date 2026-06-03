# GUIDES

**Last updated:** 2026-06-02


---

<a id="code-ownership-by-surface"></a>

## CODE OWNERSHIP BY SURFACE

*Merged from `docs/development/CODE_OWNERSHIP_BY_SURFACE.md` on 2026-06-02.*

# Code Ownership By Surface

**Last Updated:** 2026-04-29

## Runtime Surfaces

- **API Host / routing composition**
  - Owner files: `middleware-platform/server.js`, `middleware-platform/routes/*`
  - Responsibilities: route mounting, middleware order, endpoint composition

- **Business/service orchestration**
  - Owner files: `middleware-platform/services/*`
  - Responsibilities: domain logic, state transitions, integration orchestration

- **Landing web UX**
  - Owner files: `unified-dashboard/somo-landing/src/*` (marketing); `_archive/littlelab-landing/src/*` (legacy)
  - Responsibilities: user flows, API calling patterns, presentation state

- **Patient app UX**
  - Owner files: `patient-app/app/*`, `patient-app/src/*`
  - Responsibilities: mobile session UX, patient journey screens, API clients

- **Operational automation**
  - Owner files: `scripts/*`, `middleware-platform/scripts/*`
  - Responsibilities: checks, migrations, diagnostics, release verification

## High-Risk Change Areas

- `middleware-platform/server.js` route/middleware order
- payment + webhook reconciliation (`routes/payment.js`, webhook handlers, payment services)
- reasoning and snapshot contracts (`services/reasoning-*`, `services/session-*`)
- public plan/geo/coverage contract paths (`routes/public-plan-search.js`, `routes/public-geo.js`)
- payor canonicalization + precheck (`services/payor-*`, `services/provider-network-*`)

## Required Documentation Update Rule

When adding or materially changing:
- a route file in `middleware-platform/routes/`, or
- a service file in `middleware-platform/services/`,

update at least one of:
- `docs/middleware-platform/README.md` (ownership tables/maps)
- `docs/meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md` (gap closure tracker)

CI doc parity check is enforced by `scripts/check-docs-route-service-parity.cjs`.


---

<a id="scripts-operations-map"></a>

## SCRIPTS OPERATIONS MAP

*Merged from `docs/development/SCRIPTS_OPERATIONS_MAP.md` on 2026-06-02.*

# Scripts Operations Map

**Last Updated:** 2026-04-29

## Purpose

Map operational scripts to safe usage level so engineers can run the right checks without accidental production-impacting actions.

## Tiers

- **Tier A (safe/read-only checks)**
  - verification/report scripts
  - examples: `scripts/check-*.mjs`, `scripts/report-*.cjs`, `verify:*` npm scripts

- **Tier B (controlled write to local/test state)**
  - local migrations, local seeders, local replay scripts
  - requires explicit `DB_PATH` and environment awareness

- **Tier C (external side effects / prod-adjacent)**
  - deployment scripts, remote mutation scripts, credential/domain setup scripts
  - should run only with owner approval and change tracking

## Script Families

- **Root scripts (`scripts/`)**
  - deployment and environment setup
  - UI/API smoke checks
  - docs and guardrail checks

- **Middleware scripts (`middleware-platform/scripts/`)**
  - payor pipeline, readiness, observability
  - reasoning gates and E2E checks
  - payment/ops diagnostics and recovery tasks

## Required Script Execution Notes

- Always set/verify `DB_PATH` before stateful middleware scripts.
- Prefer dry-run flags where available.
- Capture outputs for audit when running Tier C scripts.
- Link operational outcomes back to `docs/runbooks/` or `todos/` tracking items.
