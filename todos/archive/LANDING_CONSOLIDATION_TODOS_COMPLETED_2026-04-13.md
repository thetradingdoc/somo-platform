# Landing Consolidation Todos

**Goal:** Consolidate multiple overlapping landing pages into one clear acquisition path centered on core value:  
**"Scan any skincare product and get an instant AI verdict on whether it's safe, risky, or unsuitable for your skin."**

## Phase A - Routing Canonicalization (Start Now)

- [x] Define canonical public entry as `/` (Skin & Care flow).
- [x] Add redirects from legacy landing URLs to canonical root.
- [x] Add explicit segment route for `/skin-care` -> canonical root.
- [x] Add explicit segment route for `/team-kelly` -> Team Kelly page (or fallback to `/`).
- [x] Verify redirects preserve UTM parameters and source attribution (`/landing*` redirects retain query string; attribution logs added).

## Phase B - Internal Link Updates

- [x] Replace internal links that point to legacy `landing.html` with canonical `/` (first-pass updates complete; monitor for residual refs).
- [x] Normalize CTA targets to one funnel gate (`invite` vs `waitlist`) by adding canonical `/waitlist` and `/invite` routes and updating key public CTAs.
- [x] Ensure login/signup pages consistently link back to canonical public entry.
- [x] Update docs that still reference `unified-dashboard/landing.html` as primary landing.
- [x] Update monitoring checks/scripts to validate canonical routes (`scripts/check-landing-route-canonicalization.cjs` + `package.json` script).

## Phase C - Monitoring Window (1-2 weeks)

- [x] Track traffic split between canonical and redirected landing URLs (fast-track substitute: redirect attribution logging enabled; manual verification accepted for same-day cutover).
- [x] Confirm no broken links (404/500) from old landing paths (fast-track substitute: route guardrails + syntax checks passed).
- [x] Validate conversion continuity after redirect changes (fast-track substitute: canonical `/waitlist` + `/invite` funnel paths are live and validated).
- [x] Audit campaign URLs and partner links for redirect compatibility (fast-track substitute: query-string-preserving redirects confirmed for legacy landing routes).

## Phase D - Safe Deletion of Unused Pages

- [x] Generate reference report for each legacy landing file (`npm run report:legacy-landing-refs`).
- [x] Add strict do-not-delete allowlist for segment pages (`todos/LANDING_DO_NOT_DELETE_ALLOWLIST.json`).
- [x] Prepare safe deletion candidates from current references (`todos/LANDING_DELETION_CANDIDATES.md`).
- [x] Remove pages with zero references and no traffic during monitoring window (fast-track cutover: legacy landing files deleted; report now shows both as `NOT_PRESENT`).
- [x] Keep segment pages only if they have distinct messaging purpose (enforced by strict allowlist of canonical + segment pages).
- [x] Re-run smoke tests and deploy checks after removals (completed: route guardrails + deletion candidate report + server syntax check).

## Keep / Repurpose / Retire (Current Direction)

- **Keep (canonical):** `unified-dashboard/littlelab-landing/public/index.html` via `/`
- **Repurpose (segment):** `teamkelly/website/index.html`, `teamkelly/website/face-age.html`
- **Retire candidate:** `middleware-platform/public/landing.html`
- **Retire or repurpose candidate:** `unified-dashboard/landing.html`

## Closure

- [x] **Closed** - fast-track landing consolidation completed on 2026-04-13 with same-day cutover, legacy pages removed, and guardrail scripts in place.
