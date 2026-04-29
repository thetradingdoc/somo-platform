# Landing Navigator UI/UX Redesign — Pending Tasks

Date: 2026-04-27  
Owner: Product + Design + Frontend + Middleware  
Status: In progress

## Current Goal

Deliver a clear two-step experience:
- `"/"` = Search 1 CTA (location + needs, minimal friction)
- `"/?view=results"` = Search 2 workspace (full filter refinement + results + detail/compare)

## Pending Tasks (Prioritized)

### Batch 4 — Mobile-first filter and compare simplification

- [x] Enforce one authoritative filter system on results:
  - desktop: left filter rail only
  - mobile/tablet: single `Filters` drawer trigger
  - remove duplicated top quick-filter chips on results view
- [x] Simplify sticky results top row:
  - keep only sort + filters trigger (+ compare trigger on smaller screens)
  - remove conflicting redundant chips/icons
- [x] Convert compare panel to progressive disclosure on mobile/tablet:
  - hidden by default
  - open via `Compare (n)` drawer trigger
  - keep full sticky right panel behavior on desktop
- [x] Align filter icon semantics to user-facing meaning (remove ambiguous metaphors).
- [x] Verify runtime freshness in local dev flow (avoid stale copy from hot-reload/cache during QA).

### Batch 1 — Core UX fixes

- [x] Remove duplicate filter icon layers on results page; keep one authoritative filter control row.
- [x] Enforce one standard icon set across landing and results (Heroicons outline, no mixed emoji/symbols).
- [x] Fix location ambiguity: resolve landing location into searchable ZIP/state/county before results fetch.
- [x] Ensure Search 1 vs Search 2 separation:
  - landing = CTA only
  - results = full filtering and decision workspace
- [x] Remove technical-first language from primary UI (patient-friendly naming only).

### Batch 2 — Filter system redesign (image-2 style)

- [x] Rebuild left filter rail using grouped categories + checkboxes:
  - Coverage needs: Dental, Vision, Hearing
  - Costs: monthly premium ranges
  - Ratings: 1–5 star ranges (with quick 4+, 4.5+ options)
  - Location: ZIP/state/county selector
  - Plan style: HMO/PPO/etc.
- [x] Move advanced-only options into collapsible “More filters”:
  - Max yearly cost
  - Data certainty
  - Approval needed
- [x] Unify filter state model so top chips, rail controls, and URL params always match.
- [x] URL-sync all selected filters for shareability/reload:
  - `zip`, `location`, `needs[]`, `cost`, `stars`, `plan_style`, `payor`, etc.

### Batch 3 — Results workspace redesign

- [x] Full-screen results layout grid:
  - left filter rail
  - center results list
  - right sticky detail/compare panel
- [x] Sticky top search/filter bar that remains visible while scrolling.
- [x] Rebuild plan cards for scanability:
  - plan/payor
  - monthly cost (prominent)
  - star rating
  - matched needs summary
  - concise warning (if any)
  - CTA actions
- [x] Strengthen right detail panel:
  - selected plan details by default
  - compare up to 2 plans
  - clear compare behavior
- [x] Add zero-results guardrails with clear recovery actions:
  - show active restrictive filters
  - one-click filter reset suggestions

### Data quality + scale tasks

- [x] Normalize payor names to canonical display values to reduce repetition across cards/rails/results.
- [x] Expand featured payor retrieval beyond single query strategy (multi-sort fetch + merge + dedupe).
- [x] Confirm and switch to larger GCP-backed dataset where available for broader catalog coverage.
- [x] Keep robust fallback to local data when remote endpoint is unavailable.

### UX polish + consistency

- [x] Keep landing minimal (“less is more”):
  - `Location`, `Needs`, `Search`
  - optional lightweight discovery chips only
- [x] Ensure copy consistency for friendly filter labels:
  - Max yearly cost
  - Plan style
  - Data certainty
  - Approval needed
- [x] Standardize spacing, typography, and visual hierarchy to match target reference quality.
- [x] Ensure responsive behavior:
  - desktop 3-pane
  - tablet 2-pane/drawer
  - mobile stacked with filter drawer

### Reliability + validation

- [x] Add frontend tests:
  - Search 1 -> Search 2 transition
  - filter state sync and URL persistence
  - compare interactions
- [x] Add API contract tests for user-friendly error handling.
- [x] Rebuild + smoke test with running middleware server and verify no raw server errors in UX.

## Definition of Done

- [x] Landing is a clean CTA-only entry with no duplicated results controls.
- [x] Results page has a single, clear filter system (grouped + checkbox) and no duplicate layers.
- [x] Location behavior is explicit and reliable (resolved for search).
- [x] Full-screen results workspace is easy to scan and compare.
- [x] Filter icons and labels are consistent and patient-friendly across pages.
- [x] Data normalization reduces payor repetition materially.

## Added from `todo_gap_review.html` (Pending)

### Batch 5 — Redesign gap closure (new)

- [x] Define exact "best match" scoring formula before coding:
  - explicit score equation
  - cutoff for `best` vs `partial`
  - tie-break rule (premium/stars/moop)
- [x] Decide and document where `best coverage` sort runs:
  - client-side sort (`matched_needs.length`)
  - or backend `sort_by=coverage` support
- [x] Convert broad responsive TODO into concrete constraints:
  - body text minimum on mobile
  - tap target minimum for buttons/chips
  - compare drawer must not obscure last card footer/actions
- [x] Convert generic accessibility TODO into explicit requirements:
  - warning section semantics (alert/announcement behavior)
  - sort toggle states (`aria-pressed`)
  - compare drawer focus management when open
  - coverage pills accessible labels
- [x] Expand regression coverage with named transitions:
  - flip-card to results handoff
  - ZIP change triggers re-search
  - payor context handoff to results

### Batch 6 — Missing UX/system tasks (new)

- [x] Add empty-results fallback mode:
  - show `No exact matches`
  - render closest partial matches instead of hard blank state
- [x] Add loading skeleton cards during results fetch.
- [x] Add explicit results error-state UI for:
  - network failure
  - endpoint not found
  - data still loading
- [x] Surface `prior_auth` directly in plan cards/details:
  - e.g. `Dental — prior approval required`
- [x] Allow ZIP edit directly from results workspace (inline, no back navigation required).
- [x] Add progressive results loading:
  - show initial subset first
  - `Show more plans` control for additional rows
- [x] Add plan print/share action:
  - printable detail view
  - easy handoff for caregiver/family review
- [x] Add human-help fallback CTA:
  - visible `Need help choosing?` action in results view
- [x] Add readability control:
  - A / A+ text size toggle
  - persist preference in local storage

### Batch 7 — Results redesign parity pass (new)

- [x] Adopt 3-bar results header structure from redesign:
  - top stats row: plans found, selected needs, avg monthly premium, ZIP
  - dedicated sort row with clear active state styling
  - dedicated "showing plans that cover" row with add-need action
- [x] Refactor results cards to sectioned anatomy:
  - card header: badges, plan name/insurer/type, premium, star visual
  - cost strip: yearly max + data source
  - coverage strip: explicit covered vs not-covered chips
  - warnings strip: uncovered critical benefits as pills
  - footer strip: full details + compare actions
- [x] Replace current right compare panel with bottom compare drawer:
  - show only when at least 2 plans are selected
  - side-by-side row matrix for price, yearly max, stars, plan type, needs
  - explicit clear-compare action in drawer header
- [x] Strengthen match and state badges:
  - normalize badge set to Best match / Partial coverage / Estimated data
  - apply consistent ordering and color semantics across all cards
  - improve selected/best visual borders for instant scanability
- [x] Improve warning communication quality:
  - prioritize plain-English negative coverage statements
  - list uncovered high-risk categories first (ambulance, emergency, specialist, hospital)
  - keep warnings persistent and visible without requiring expansion
- [x] Improve coverage truth visibility in card body:
  - avoid text-only "needs matched" as primary signal
  - expose both positive and negative coverage states at first glance
  - include simple cost details (e.g., copay) where available
- [x] Tighten visual system consistency in results workspace:
  - normalize spacing rhythm, borders, chip sizes, and typography scale
  - reduce visual noise from mixed button styles and text blocks
  - align CTA prominence with primary decision tasks
- [x] Improve decision speed and action clarity:
  - make compare action more prominent and stateful
  - rename/standardize detail CTA language to task-oriented copy
  - ensure top-level context (needs + ZIP + sort) stays obvious while scrolling

### Batch 8 — Results parity polish gaps (new)

- [x] Reduce duplicated results-page control chrome:
  - remove or condense legacy hero/search controls when `view=results`
  - keep a single primary decision surface (stats + sort + needs)
  - prevent stacked control bars from pushing cards too far below fold
- [x] Tighten card information density and vertical rhythm:
  - reduce extra text blocks and non-essential line items in card body
  - match compact spacing cadence from redesign reference
  - keep cost, coverage, and warning blocks visible without excessive card height
- [x] Improve warning block emphasis and clarity:
  - strengthen warning title + icon hierarchy
  - keep warning pills visually distinct from standard coverage chips
  - prioritize explicit negative statement style (`does NOT cover`) language
- [x] Align top stats visual treatment with redesign:
  - move from boxed-card feel to cleaner segmented bar rhythm
  - add consistent divider pattern between summary stats
  - preserve high scanability for needs/ZIP/avg cost context
- [x] Normalize pills, badges, and borders to one visual token system:
  - consistent border thickness, radius scale, and chip height
  - unify active/selected/best/partial color semantics
  - reduce visual noise from mixed component weights
- [x] Improve card header right-column polish:
  - refine premium/stars alignment and spacing
  - adopt cleaner star visual treatment parity
  - ensure right column remains compact across responsive breakpoints
- [x] Add explicit per-card data trust note parity:
  - include footer-level `Estimated data` note treatment
  - keep note styling consistent and non-dominant
  - reinforce verification guidance before enrollment
- [x] Polish compare drawer typography and matrix legibility:
  - tune label/data font sizes and contrast ratios
  - improve row spacing and scannability for multi-need comparisons
  - keep table readable on narrow widths without losing hierarchy
- [x] Final copy and micro-interaction parity pass:
  - align labels/CTA wording with redesign language style
  - smooth hover/active state transitions for sort and compare controls
  - ensure consistent tone and action clarity across results workflow

### Batch 9 — Location resolution correctness and precision safety (new)

- [x] Add ZIP resolution request guard to prevent stale async overwrites:
  - add `zipResolutionRequestId` (or abort controller) in results location flow
  - ignore late responses for superseded ZIP requests
  - ensure rapid ZIP edits never repopulate old state/county values
- [x] Enforce hard clear + deterministic location state machine on ZIP commit:
  - immediately clear `filterState.state`, `filterState.county`, and `resolvedLocation`
  - introduce `locationStatus`: `idle | resolving | exact_zip | ambiguous_zip | unresolved_zip`
  - allow repopulation only from the latest valid geo resolution response
- [x] Implement strict search gating by location precision:
  - allow search only when precision is explicit (`exact_zip`, or `ambiguous_zip` after county choice)
  - block unresolved ZIP search until user confirms fallback scope
  - prevent implicit search submissions from stale or partial ZIP state
- [x] Replace raw ZIP-driven search payload with explicit location scope contract:
  - send location payload with `type` (`zip | county | state`) and scoped fields
  - stop sending unresolved ZIP as if it were exact precision
  - keep existing needs/sort semantics unchanged while migrating scope fields
- [x] Add backend precision contract and remove silent fallback semantics:
  - return `scope_requested`, `scope_used`, and `precision` on search responses
  - treat crosswalk misses as explicit fallback status, not hidden behavior
  - preserve `zip_geo_fallback` temporarily for compatibility until UI migration completes
- [x] Add mandatory precision labeling in results UI:
  - show clear scope badge/banner (`Exact ZIP`, `County fallback`, `State fallback`)
  - prohibit ZIP-exact language when backend precision is fallback
  - surface unresolved mapping guidance with next action (choose county/state)
- [x] Fix stale location display invariants across all entry points:
  - enforce same clearing/resolution behavior for inline ZIP edit, filter panel ZIP, and URL hydration
  - clear incompatible county when state changes and vice versa
  - ensure displayed state/county always belongs to the current committed ZIP resolution cycle
- [ ] Add regression tests for race conditions and scope correctness:
  - frontend tests for rapid ZIP A->B changes and stale response suppression
  - API contract tests for `scope_requested/scope_used/precision`
  - e2e tests validating no silent fallback and correct labels for unresolved ZIPs (e.g., `07205`, `10469`)

### Batch 10 — Card/UI audit remediation pass (new)

- [x] Fix dead text-scale controls in `index.js`:
  - either restore interactive `useState` + setter for `textScale`
  - or remove A/A+ buttons entirely so UI matches behavior
- [x] Merge duplicate `.plan-actions` rules in `styles.css`:
  - keep one canonical rule
  - preserve intended `gap` and `align-items` values explicitly
- [x] Resolve results layout dead space:
  - align `navigator-main-grid` columns with actual children
  - either render a real second panel or switch grid to single-column on results
- [x] Fix mobile results-toolbar overflow:
  - remove/override forced `nowrap` behavior on narrow screens
  - eliminate fixed-width button overflow pattern in `navigator-results-tools`
- [x] Rebalance card front/back mobile density:
  - prevent front-face clipping in content section
  - keep back-face stats + tags + actions visible without overflow
  - verify button placement does not hide critical content on iPhone widths
- [x] Replace hardcoded semantic tag and legend colors with token variables:
  - use `var(--color-text-success|warning|danger)` and related background/border tokens
  - ensure parity in both light and dark themes
- [x] Improve back-card messaging state:
  - show warning style only when missing tags exist
  - render a non-warning success treatment when no major gaps are present
  - avoid orphaned `Covered` header when there are no covered/partial tags
- [x] Normalize card action shape system:
  - unify action radii across front/back CTA elements
  - keep consistent interaction hierarchy and spacing
- [x] Tighten results-page vertical economy:
  - hide/de-emphasize hero marketing header on results workflow
  - conditionally apply bottom spacing that currently always reserves compare drawer space
- [x] Improve accessibility + feedback polish:
  - add loading semantics (`role="status"`, `aria-live`) for skeleton states
  - show explicit Search button progress label while ZIP resolution is in progress
  - remove dead CSS selectors no longer referenced in JSX (`results-help-link`)
- [x] Replace hardcoded star visual colors with theme tokens:
  - update filled/empty/value star color rules for contrast-safe theming
- [x] Refine responsive stats wrapping at mid breakpoints (760-1024):
  - prevent uneven wrapping and border artifacts in `results-top-bar`
  - use breakpoint-specific grid/flex strategy for predictable layout

### Batch 11 — Back-of-card parity fix (template match)

- [x] Remove blank/filler area on flipped back card:
  - eliminate large empty panel below stats/actions on desktop and mobile
  - ensure back face height is content-driven within card bounds
  - prohibit visual dead zone when coverage/missing blocks are present
- [x] Enforce strict back-face section order to match template:
  - `back-header` (name + subtitle + badge)
  - `stats-grid` (4 boxes always visible)
  - `coverage-section`
  - `missing-alert` (or success alert)
  - `back-footer` (actions)
- [x] Keep footer actions pinned to bottom strip without hiding body:
  - footer always visible (`View full details`, `Back`)
  - body section scrolls only when truly needed
  - no overlap between body and footer at any viewport
- [x] Guarantee all 4 stat boxes render visibly in first viewport of back card:
  - monthly cost
  - star rating
  - yearly max
  - prior approval
  - no clipping of row 2 stats under any card height mode
- [x] Fix coverage/missing visibility invariants:
  - `Covered` title never appears without chips
  - coverage chips always render fallback labels when sparse API tags occur
  - missing block shows only when missing tags exist
  - success block shows when no missing tags exist
- [x] Align back-card copy with template wording:
  - `Star rating` value format: `X.X / 5.0`
  - `Prior approval` value format: `Low burden | Medium burden | High burden`
  - primary CTA copy: `View full details →`
- [x] Restore template visual hierarchy on back face:
  - distinct `back-body` container and `back-footer` strip
  - consistent spacing rhythm between stats, covered, missing, and footer
  - no compression that collapses coverage/missing sections
- [x] Normalize desktop + mobile behavior:
  - desktop back card shows all core sections without user scroll in common viewport
  - mobile keeps sections readable and non-overlapping
  - no section disappearance during flip transition
- [x] Add targeted regression coverage for back face:
  - component/UI tests asserting presence of stats row 1+2, coverage, missing/success, and footer buttons
  - Playwright checks for desktop and mobile screenshots of flipped back card
  - test against at least 3 payors with different tag distributions

### Batch 12 — Full details + compare surfaces wiring (from `full_details_and_compare_design.html`)

- [x] Implement `See full details` as a true detail surface (not duplicate card summary):
  - clicking `View full details →` sets `activePlanId`
  - render dedicated detail drawer/panel using selected plan from `results[]`
  - keep close/back behavior consistent with existing results workflow
- [x] Build full-details layout with 5 fixed sections:
  - identity header (plan name, payer, type, stars, confidence/source chips)
  - cost boxes (monthly premium, MOOP, selected cost signals)
  - coverage evidence table
  - critical uncovered gaps block
  - bottom actions row (compare/share/print + enrollment handoff if enabled)
- [x] Wire coverage evidence table directly from `coverage_detail[need]`:
  - one row per supported need (or selected + expanded list mode)
  - show covered/not covered, copay (when present), prior auth flag
  - ensure row ordering is predictable and user-friendly
- [x] Expose prior-authorization burden in plain language:
  - map need-level `prior_auth` to sentence-style summary (`Low burden — no pre-approval required`, etc.)
  - surface both aggregate burden and per-need prior-auth markers
- [x] Add explicit "Not available yet" expectation chips in full details:
  - prescriptions/formulary
  - doctor network (in-network search)
  - deductible
  - coinsurance
  - style as informational disclaimers, not errors
- [x] Replace current compare panel surface with 2-plan matrix mode:
  - activate matrix when exactly 2 plans are selected (`compareIds.length === 2`)
  - preserve current `toggleCompare(contractId)` behavior
  - keep compare clear/remove interactions obvious
- [x] Add client-side winner badges to compare rows:
  - lower premium winner
  - higher stars winner
  - higher needs-covered winner
  - "only here" badges for asymmetric coverage rows
- [x] Add "needs covered" summary row as top decision signal:
  - compute from matched coverage count (e.g., `2 of 9` vs `3 of 9`)
  - highlight stronger plan using visual emphasis
- [x] Add yellow help banner CTA in compare surface:
  - appears when compare matrix is visible
  - text focuses on guidance for overwhelmed seniors
  - wire action to existing help/contact flow
- [x] Validate full-details and compare data fidelity against API payload:
  - every rendered evidence row must map to real fields in `results[]`
  - no synthetic values presented as factual coverage
  - include source/confidence context where data is estimated
- [x] Add regression tests for new surfaces:
  - unit/component tests for detail section rendering and prior-auth mapping
  - Playwright tests for detail open/close, compare matrix, winner badges, needs-covered row, and help banner
  - screenshot baselines for desktop + mobile

### Batch 13 — Focused UX parity polish (details + compare)

- [x] Remove duplicate print/share surfaces:
  - remove bottom global Print/Share controls from results page
  - keep utility actions inside active detail/compare surfaces only
- [x] Strengthen compare-selection state:
  - add explicit visual state for cards selected for compare
  - add selected compare badge/copy in card header region
  - increase selected-state contrast (border + tint + emphasis)
- [x] Enforce semantic color parity across list + details + compare:
  - ensure `Covered` uses green semantic pills
  - ensure `Not covered` uses red semantic pills
  - ensure prior-auth required markers use warning semantic treatment
- [x] Normalize spacing/typography consistency across list + panel + compare grid:
  - align section paddings, chip sizes, row heights, and heading scales
  - reduce dense/uneven spacing in compare grid and detail table
  - ensure action rows use one consistent button size rhythm

### Batch 14 — Production-grade geo mapping + resolver hardening

- [x] Create canonical geo reference layer (versioned):
  - add `geo_zip`, `geo_county`, `geo_zip_county_map` tables keyed by `zip5` + `county_fips`
  - add optional `geo_city_zip_map` support for city assist
  - add `geo_dataset_versions` metadata table for active + previous release pointers
- [x] Implement deterministic location resolver service:
  - add shared `resolveLocation({ zip?, city?, state?, county? })`
  - return canonical scopes: `zip_exact`, `zip_ambiguous`, `zip_unmapped`, `county_exact`, `state_fallback`
  - ensure all public geo + plan routes use this resolver (single behavior contract)
- [x] Build idempotent canonical geo ingestion flow:
  - load authoritative ZIP/county + county master into canonical tables
  - normalize to county FIPS joins only (no text-only join paths)
  - support atomic active-version switch + rollback to previous version
- [x] Add strict geo correctness gates for release:
  - block release if canonical tables missing or referential integrity fails
  - validate every service-area `county_fips` exists in canonical county dimension
  - validate resolver parity on nationwide state/ZIP samples
- [x] Expand API diagnostics + observability:
  - include `geo_version` in `/api/public/geo/health` and `/api/public/plans/meta`
  - emit resolver outcome metrics: `% zip_exact`, `% zip_unmapped`, `% zip_ambiguous`, `% fallback_state`
  - add alert hooks for state/ZIP-prefix unmapped spikes
- [x] Enforce UI truthfulness contract:
  - always show actual scope used (`ZIP exact`, `County fallback`, `State fallback`)
  - never silently reuse stale zip/state/county across searches
  - keep full state/county selectors available nationwide
- [x] Add automated regression suite (API + UI):
  - API contract tests for each resolver scope with deterministic fixtures
  - Playwright E2E checks that entered ZIP is preserved and warnings are correct
  - add smoke test matrix across NY/TX + random nationwide ZIP samples
