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
  - Owner files: `unified-dashboard/littlelab-landing/src/*`
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
