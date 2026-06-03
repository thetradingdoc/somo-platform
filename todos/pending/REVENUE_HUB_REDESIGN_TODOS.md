# Revenue Hub Redesign — Implementation Checklist

Completed 2026-06-03. Maps to the 39-item UI audit (`somo_ui_audit.html`).

## Phase 0 — Design system
- [x] Revenue CSS components (`.pp-revenue-tabs`, `.pp-table-wrap`, `.pp-status-pill`, `.pp-journey-chip--pill`, KPI semantic colors)
- [x] Heroicons keys: plus, clock, user-check, clipboard, inbox-stack, arrow-path, paper-airplane
- [x] Sidebar active left border + nav weights
- [x] Kelly provisioning banner suppressed when live + ready
- [x] Martian Mono on `.pp-kpi-val` (24px)

## Phase 1 — Backend
- [x] `revenue_badges` on `GET /api/rcm/metrics/health`
- [x] Clinic-scoped `GET /api/admin/billing/eob` + `summary` totals
- [x] Collection queue includes `bill` + `patient_collection`, `resend_eligible`, `patient_name`
- [x] Payment list `patient_name` (existing)
- [x] Kelly activity hrefs → `revenue.html?tab=payments`
- [x] Jest: `__tests__/rcm-revenue-badges.test.js`

## Phase 2 — Revenue hub shell
- [x] `revenue.html` + `revenue-shell.js` + `revenue-ui.js`
- [x] Sidebar collapsed to one **Revenue** item; Exception inbox removed from AI Ops
- [x] `STAGE_CTA_HREF` → `revenue.html?tab=*`
- [x] Legacy redirects (`legacy-provider-redirect.js`, stub pages)
- [x] Today links → `revenue.html?tab=pipeline`

## Phase 3 — Pipeline tab
- [x] KPI tiles with semantic colors
- [x] Journey pill chips with icons + tones
- [x] Collection queue table with status pills + Resend via Kelly

## Phase 4 — Claims tab
- [x] KPI row (total billed / plan paid / you owe)
- [x] Claims & EOB 4-column table
- [x] Remittance section with `#remittance` anchor
- [x] Create claim panel (+ link to legacy scan workspace)

## Phase 5 — Patient pay tab
- [x] KPI tiles from payments summary
- [x] Composer strip + Send via Kelly
- [x] Status pills + filters + Resend via Kelly

## Phase 6 — Work queue tab
- [x] Prior auth empty state with icon
- [x] Exception inbox table + Review (drafted-fix apply)

## Phase 7–8 — Tests & docs
- [x] Playwright: `provider-revenue-hub.spec.cjs`, updated `provider-portal-shell.spec.cjs`
- [x] `docs/RCM/ARCHITECTURE.md` Revenue hub contract
- [x] This checklist

## Legacy escape hatch
- `billing.html?section=scan&legacy_tabs=1` — full PDF scan workspace until inline slide-over is complete
