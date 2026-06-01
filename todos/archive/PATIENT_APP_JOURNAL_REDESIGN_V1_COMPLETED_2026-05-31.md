> Archived from todos/pending/ on 2026-05-31 — v1 complete.

# Patient App Journal Redesign — Unified Execution Todo

Date: 2026-04-22  
Owner: Product + Mobile + Middleware  
Status: Journal V1 execution complete (see phase checklists); optional follow-ups in product backlog.

## Why This Rewrite

This document replaces the fragmented checklist with one start-to-end execution plan.
It also captures what changed in the latest iterations.

## Change Log (New / Changed / Removed / Updated)

### New
- Added explicit routine-journal backend contracts:
  - `GET/POST /api/patient/routine/template`
  - `GET/POST /api/patient/routine/daily`
  - `POST /api/patient/routine/daily/:id/media-link`
  - `GET /api/patient/home/progress-summary`
- Added routine template builder UI on `Routine` page.
- Added Home routine board with list/grid presentation.

### Changed
- IA finalized to:
  - `Home / Calendar / Products / Routine / More`
- Home direction changed from wallet-first to routine-first.
- Routine page direction changed from appointments-heavy to template-builder-first.

### Removed
- Removed noisy appointment/filter/chat sections from `Routine` page.
- Removed legacy top-home controls that conflicted with routine-first UX.

### Updated
- New-user empty states simplified.
- Scan FAB behavior became conditional:
  - hidden when no routine template exists
  - compact `+` only when routine exists (to add entry quickly)

---

## Product Goal (V1)

Ship a simple skincare tracking journal where users can:
- create reusable routine templates
- log AM/PM completion daily
- record skin report + notes
- save picture per day
- review progress summary on Home

---

## Scope Guardrails (V1)

- Do not rebuild telemedicine architecture.
- Do not add OAuth/password auth in this phase.
- Keep onboarding/login hardening in scope only where it affects routine onboarding.
- Keep wallet/profile under `More`, not as Home-first content.

---

## Status Snapshot

### Completed
- [x] Step 3 moved to routine/product baseline capture.
- [x] Login/verify redirect gating fixed to respect onboarding completion.
- [x] Catalog-first Step 3 search + custom fallback + enrichment/dedupe.
- [x] Tab IA remap (`Home/Calendar/Products/Routine/More`).
- [x] Home routine board (list/grid shell) implemented.
- [x] Routine page cleaned to remove appointment clutter.
- [x] Routine backend schema/APIs for template, daily entries, and media links.
- [x] Guided routine builder, daily journal UI, picture-of-day, inventory fields, calendar conflict safety, analytics + catalog/routine alerts.
- [x] Claim-session bridge + tests (401 + claim→shelf service chain).

### Remaining (post-V1 / backlog)
- [ ] Symptom/condition tracker categories and trigger logging.
- [ ] Push alerts/reminders (separate from Phase 8 event logging).

---

## Start-to-End Execution Plan

## Phase 0 — IA + Navigation Consistency
- [x] Finalize tab IA and labels.
- [x] Keep `More` as profile/wallet entry point.
- [x] Ensure bottom tabs/side nav labels are consistent across pages.

Acceptance:
- IA labels are identical everywhere.

---

## Phase 1 — Onboarding to Routine Baseline
- [x] Step 3 contract saved as routine/product baseline.
- [x] Catalog-first selection with explicit custom fallback.
- [x] Step 3 copy simplification:
  - [x] plain language
  - [x] clear outcomes
- [x] Complete Step 2 skip semantics copy for V1.

Acceptance:
- Users can always finish onboarding with baseline routine data.

---

## Phase 1.5 — Claim-Session Bridge (Landing -> Customer)

- [x] Spec claim-session contract:
  - [x] source rows (`orchestrate session`, thread events, snapshots)
  - [x] target identity (`customer_id`)
  - [x] idempotency + abuse controls
- [x] Add authenticated route (not anonymous public):
  - [x] `POST /api/customer/landing/claim-session`
  - [x] require authenticated customer session
  - [x] body requires `landing_session_id`
- [x] Implement DB migration:
  - [x] `customer_products` (`customer_id`, `merchant_id?`, `barcode`, `product_json`, `source_session_id`, `scanned_at`)
  - [x] unique index for dedupe/upsert
  - [x] optional `claim_audit` table
- [x] Implement claim service:
  - [x] copy/normalize `barcode_product_context` + latest snapshot to `customer_products`
  - [x] link/backfill orchestrate rows where safe
- [x] Client flow after OTP verify:
  - [x] read `sessionStorage` landing sid
  - [x] call claim-session endpoint after customer session is set
  - [x] handle errors and clear/replace sid strategy
- [x] Future scan behavior:
  - [x] when `customer_session` exists, upsert `customer_products` on successful scan/thread event
- [x] Shelf API + minimal UI:
  - [x] `GET /api/customer/products` (or shelf alias)
  - [x] minimal claimed-products list in landing/portal
- [x] Tests:
  - [x] claim idempotent
  - [x] unauth returns 401 (`__tests__/claim-session-http.test.js`)
  - [x] wrong customer cannot claim foreign `session_id`
  - [x] E2E chain: claim → shelf row (`listCustomerProducts` after claim in `landing-session-claim-service.test.js`; full customer signup UI E2E optional)

Acceptance:
- Landing scans can be safely and deterministically claimed into customer shelf data.

---

## Phase 2 — Routine Template Model (Core)
- [x] Create routine template + template item persistence.
- [x] Save source linkage to shelf/onboarding products.
- [x] Add template duration/repeat controls in API + UI:
  - [x] start date
  - [x] number of days
  - [x] repeat cadence (daily / selected days)

Acceptance:
- User can create a reusable routine template and schedule horizon.

---

## Phase 3 — Daily Journal Logging
- [x] Daily entry storage exists (`entry_date`, `skin_report`, `notes`, `completion_score`).
- [x] Daily item log persistence exists.
- [x] Daily media link persistence exists.
- [x] Build routine daily log UI:
  - [x] AM/PM checklist
  - [x] simple skin report fields
  - [x] notes
  - [x] save/update flow
- [x] Build picture-of-day UI flow:
  - [x] upload/select photo
  - [x] attach to daily entry
  - [x] show linked media in day summary

Acceptance:
- A user can complete daily routine, submit skin report, and save picture per day.

---

## Phase 4 — Home routine-first
- [x] Home routine board consumes `GET /api/patient/home/progress-summary` (strict routine-derived metrics).
- [x] Empty state + conditional scan FAB when no template.
- [x] List/grid presentation for routine cards.

Acceptance:
- Home is routine-first with real summary data when a template exists.

---

## Phase 5 — Routine Builder UX (Canva-like)
- [x] Replace raw builder controls with guided flow:
  - [x] name template
  - [x] choose products
  - [x] set AM/PM blocks
  - [x] set repeat duration
  - [x] review + save
- [x] Keep language simple and action-first.

Acceptance:
- Creating a routine feels guided, not technical.

---

## Phase 6 — Products Inventory Upgrade
- [x] Extend product inventory schema/UI to include:
  - [x] open date
  - [x] PAO/expiry
  - [x] opened/stock/finished status
  - [x] price
  - [x] key ingredients
- [x] Support product initials/color-code display for quick logs.

Acceptance:
- Products page supports real routine planning and inventory management.

---

## Phase 7 — Calendar + Conflict Safety
- [x] Reframe calendar for actives schedule and conflict prevention.
- [x] Add conflict markers + simple safety copy.
- [x] Keep booking/telemedicine flows separate from routine journal UX.

Acceptance:
- Calendar helps users avoid conflicts and follow plan cadence.

---

## Phase 8 — Reliability, Analytics, Rollout
- [x] Add key events:
  - [x] template_created
  - [x] daily_log_saved
  - [x] picture_of_day_linked
  - [x] routine_completed_day
  - [x] home_summary_viewed
- [x] E2E coverage (API smoke): `npm run check:patient-journal-funnel` with `PATIENT_TEST_SESSION_ID` exercises progress-summary → analytics → template save → daily log → progress-summary; logs no-template path when `has_template` is false.
- [x] Add alerts for catalog index empty/stale and routine API failures.

Acceptance:
- Stable rollout with observable user funnel and fallback behavior.

---

## Deliverables

- [x] `docs/patient-app/PATIENT_JOURNAL_REDESIGN_V1.md`
- [x] `docs/patient-app/PATIENT_ROUTINE_TEMPLATE_FLOW_V1.md`
- [x] `docs/patient-app/PATIENT_DAILY_LOG_AND_MEDIA_MODEL_V1.md`
- [x] `docs/patient-app/PATIENT_HOME_SUMMARY_METRICS_V1.md`
- [x] Backend route + table docs updated (`docs/patient-app/BACKEND_ROUTES_AND_TABLES_PATIENT_PORTAL.md`)
- [x] UI screenshots for Home/Routine/Calendar/Products states (`docs/patient-app/screenshots/README.md` + `npm run capture:patient-portal-screenshots`; run `npx playwright install chromium` once)

---

## Immediate Next 5 Tasks (Execution Queue)

1. [x] Routine page: simplify copy and first-time state to one clear CTA. *(Phase 5 + journal empty states)*
2. [x] Routine page: build guided template creation stepper. *(Phase 5 wizard)*
3. [x] Routine page: add daily AM/PM log form + save. *(Phase 3)*
4. [x] Routine page: add picture-of-day upload/link UI. *(Phase 3)*
5. [x] Home: consume strict routine-derived metrics and remove placeholder behavior. *(Phase 4 / progress-summary)*

---

## Calendar Rebuild — Journal-first (Web + Mobile)

Goal: rebuild Calendar as routine tracking (not telehealth booking) with two primary views: `List` and `Calendar`, and clear media handling tied to day logs.

### 9.1 UX and IA alignment
- [x] Lock IA for journaling surfaces across web + mobile:
  - [x] `List`
  - [x] `Calendar`
  - [x] `Media` (optional in v1.1 if not shipped in v1)
- [x] Remove telehealth-first language/components from journal calendar surface.
- [x] Define icon set + active tab treatment for both sidebar and bottom tabs (no mixed styles).
- [x] Approve one accent color/token system for journaling states (header, active tab, filled day, FAB).

### 9.2 Shared data contract (calendar/list/media)
- [x] Define daily status model used by both web and mobile:
  - [x] `is_routine_day` (cadence window aware)
  - [x] `has_entry`
  - [x] `completion_score`
  - [x] `has_media`
  - [x] `thumbnail_url` (if media exists)
- [x] Add/confirm API response for month range fetch (or compose from existing daily/template APIs). (`GET /api/patient/journal/calendar-range`)
- [x] Lock day-cell rendering priority (required for both web + mobile):
  - [x] Priority 1: `has_media` => render image thumbnail tile + day-number overlay
  - [x] Priority 2: `has_entry` => render adherence/status tile (no image)
  - [x] Priority 3: `is_routine_day` => render muted \"due\" tile
  - [x] Priority 4: off-cadence/non-routine day => neutral tile
- [x] Specify empty/off-cadence/partial/completed/media visual mapping.
- [x] Add timezone rules for day-boundary consistency across clients.

### 9.3 Web rebuild (`unified-dashboard/patients/schedule.html`)
- [x] Replace current heavy booking block with journal shell:
  - [x] top summary strip (template name / adherence / date span)
  - [x] segmented `List | Calendar` control
- [x] Calendar view:
  - [x] 7-column month grid with stacked months (scroll)
  - [x] day-cell states (empty, logged, media tile) must follow locked priority rules
  - [x] image tiles include readable day-number overlay (contrast-safe on any thumbnail)
  - [x] day tap opens day detail (or routes to Routine day log)
- [x] List view:
  - [x] month-grouped chronological rows
  - [x] left date rail + summary + optional thumbnail
  - [x] row tap opens same day detail target as calendar tap
- [x] Accessibility pass:
  - [x] contrast AA
  - [x] keyboard focus + aria labels
  - [x] touch targets >= 44px

### 9.4 Mobile rebuild (`patient-app`)
- [x] Add/align top tabs for journaling (`List`, `Calendar`, optional `Media`) in RN shell.
- [x] Calendar screen:
  - [x] month-stack layout optimized for small screens
  - [x] media-backed day tiles where available (same priority rules as web)
  - [x] day-number overlay readability on photo tiles (mobile contrast-safe)
  - [x] sticky month labels during scroll
- [x] List screen:
  - [x] compact date rail rows
  - [x] truncation + preview behavior
  - [x] pull-to-refresh and optimistic state updates after save
- [x] Navigation consistency:
  - [x] day tap -> day detail/log screen
  - [x] same date opens from list and calendar paths

### 9.5 Media handling in journal context
- [x] Define media source of truth: `patient_routine_daily_media` linked to `daily_entry_id`.
- [x] Add normalized thumbnail selection rule for a day (first image, latest image, or preferred).
- [x] Add fallback behavior for days without media (status tile + completion/adherence badge).
- [x] Ensure calendar day cells show images whenever media exists for that day (image-first rendering).
- [x] Add default placeholder policy when media metadata exists but thumbnail fails to load.
- [x] If `Media` tab ships:
  - [x] filter chips (`All`, `Photo`, `Video`, `Audio`, `PDF`) and date overlays
  - [x] tap-through to originating day entry

### 9.6 Migration + compatibility
- [x] Preserve existing route paths for backward compatibility where possible.
- [x] Add feature flag for calendar rebuild rollout (`journal_calendar_v2`).
- [x] Keep legacy booking flow reachable from dedicated telehealth surface during transition.

### 9.7 QA + rollout
- [x] Unit tests for day-state mapping and cadence-window math.
- [x] API contract tests for range/calendar payloads. (`npm run check:patient-journal-calendar-range`)
- [x] Playwright web E2E:
  - [x] list/calendar toggle
  - [x] day state rendering
  - [x] day open route
- [x] Mobile smoke tests for list/calendar parity.
- [x] Screenshot refresh for docs (`Home`, `Routine`, `Calendar`, `Products`, optional `Media`).

Acceptance:
- Calendar and List both communicate routine adherence clearly.
- Media is date-linked and visible without breaking scanability.
- Web and mobile present the same mental model with platform-appropriate layouts.

---

## Navigation Visibility Standard (Web Patient Portal)

Goal: ensure patients always have a clear navigation affordance, especially on Calendar.

### Rules
- Desktop/tablet (`>= 769px`): show left sidebar, hide bottom tabs.
- Mobile (`<= 768px`): show bottom tabs, keep side menu hidden by default.
- Mobile drawer toggle (`☰`/`✕`) controls open/close of sidebar overlay only.
- Never allow a state with no visible navigation controls.

### Fixes
- [x] Mount `patient-shell` bottom tabs on `schedule.html` so mobile always has bottom nav.
- [x] Remove conflicting Calendar-only desktop override that hid sidebar and forced bottom tabs.
- [x] Align global breakpoint for hiding bottom tabs to desktop (`@media (min-width: 769px)`).
- [ ] Verify consistency on `patient-dashboard.html`, `appointments.html`, `my-records.html`, `profile.html`.
- [ ] Add Playwright UI check for nav visibility by viewport (`375x812`, `768x1024`, `1366x768`).

---

## Gap-to-Fix Checklist (Priority Ordered)

### P0 — Blockers / IA correctness
- [x] Align mobile tab IA labels/order to `Home / Calendar / Products / Routine / More`.
- [x] Preserve compatibility routes for pre-existing RN paths (`index`, `journal`, `shelf`, `insights`) during IA transition.
- [x] Replace mock/static tab content (`routine`, `shelf`, `insights`) with API-backed data paths.
- [x] Gate scan FAB visibility by template existence (`has_template` parity with web home behavior).
- [ ] Fix Playwright runner path/environment instability so CI/dev can run browser checks deterministically.

### P1 — UX and journey completion
- [x] Add explicit Home summary screen parity in RN (progress cards + no-template empty state).
- [x] Implement Calendar day-tap route to journal day detail/log in RN (same destination from list/calendar).
- [x] Implement Products inventory fields parity in RN (open date, PAO/expiry, stock, price, ingredients).
- [x] Implement More tab account utilities (profile, wallet, support, sign out).
- [x] Add offline/error fallback messaging consistency across all 5 tabs.

### P2 — Hardening and polish
- [ ] Add analytics parity on RN (`home_summary_viewed`, `template_created`, `daily_log_saved`, etc.).
- [ ] Add accessibility pass for all RN tab surfaces (labels, focus order, target size, contrast).
- [ ] Add RN screenshot automation parity with web screenshot scripts.
- [ ] Add end-to-end mobile smoke checklist and release gate hooks.
- [ ] Remove legacy hidden routes once telemetry confirms no active dependencies.

---

## Products Brain + Products Page Build Todos

Execution order: **Phase 1 UI first (HTML-guided)**, then backend + orchestration + quality.

### Phase 1 — UI First (HTML-guided)
- [x] **P0 blank-page fix:** render baseline Products shell immediately (header, tabs, first content block) so page is never blank.
- [x] Match IA tabs to HTML spec: `My Shelf`, `Info`, `Saved Scans`, `Learn`.
- [x] Build header row (`Products` title + blue `Scan` button) and wire Scan CTA to saved scan flow.
- [x] Build `My Shelf` tab:
  - [x] Search bar UI (`Search your shelf...`).
  - [x] Horizontal filter chips (`All`, `Favorites`, `To Test`, `Flagged`, etc.).
  - [x] Lists module cards (`Favorites`, `To Test`, `Flagged ingredients`) with counts and chevrons.
  - [x] Recent scans product-card list with badges (clean/caution/safe/etc.).
- [x] Build `Info` tab:
  - [x] Product header card (image, name, brand, category, badges).
  - [x] Summary stat cards (ingredients, safety score, allergens, EU restricted).
  - [x] Ingredient rows with position, role, and status dots.
  - [x] Ingredient legend (`Safe`, `Caution`, `Flagged`, `Unknown`).
  - [x] Resolution indicator (`x of y resolved`) visible in ingredient header.
- [x] Build `Saved Scans` tab:
  - [x] Timeline sections (`Today`, `Yesterday`).
  - [x] Scan item rows with timestamp, meta, and status badge (`Mapped`, `Pending`).
- [x] Build `Learn` tab:
  - [x] Education cards (`Ingredients 101`, `Safety`, `Combinations`) per HTML structure.
- [x] Ensure active states/style tokens align with mock (blue tab underline, blue CTA/button/chip states).
- [ ] Keep bottom navigation visible and non-overlapping with page content in mobile viewport.

### Phase 2 — Backend (after UI shell is in place)
- [ ] Run/verify ingredient schema migrations in all environments (`024`, `027`, plus new enrichment migration).
- [x] Add enrichment migration for safety/provenance fields on `product_ingredients` and `cosing_ingredients`.
- [x] Add `ingredient_unresolved_queue` table for unresolved token triage and iteration.
- [x] Seed `cosing_ingredients` and `ingredient_aliases` from curated baseline (idempotent script).
- [x] Implement parser/resolver improvements for `replaceProductIngredientsFromInciText` (confidence + match_method).
- [x] Implement resumable backfill job to populate `product_ingredients` from OBF/OFF product text.
- [x] Add Products API contracts for UI tabs:
  - [x] `GET /api/patient/products/catalog`
  - [x] `GET /api/patient/products/:id/info`
  - [x] `GET /api/patient/products/saved-scans`
  - [x] `GET /api/patient/products/informations`
  - [x] `GET /api/patient/products/:id/similar`
- [x] Define and implement similarity algorithm contract (`category + ingredient overlap + concern tags`) for `/similar`.
- [x] Add persistent list endpoints (`favorites`, `to_test`, custom lists) and account/session merge behavior.

### Phase 3 — Kelly Orchestration (grounded answers)
- [x] Add enrichment service to assemble `ingredients_enriched` + `ingredient_summary` payload from DB.
- [x] Attach enriched payload to scan response path (`/api/public/beautyfacts/:barcode` and foodfacts equivalent).
- [x] Replace raw ingredient text context in Kelly turn builder with structured ingredient context block.
- [x] Add Kelly prompt rule: if structured ingredient context exists, do not re-parse raw ingredient text.
- [x] Add response grounding metadata (`enrichment_version`, source fields, confidence distribution).
- [x] Add deterministic fallback behavior for low-confidence/unresolved ingredient payloads.

### Phase 4 — Data Quality / Ops / Release
- [x] Add enrichment coverage audit command (resolved %, unresolved tokens, top misses by frequency).
- [x] Add unresolved token review workflow and weekly alias expansion loop.
- [x] Add freshness/latency metrics for ingestion + enrichment jobs (SLA dashboards/alerts).
- [x] Add replay-safe idempotency checks for backfill and delta ingestion.
- [x] Add integration tests for scan -> enrichment -> Kelly context contract.
- [x] Add Playwright checks for Products IA tabs and non-blank Products page by viewport.

---

## Month-1 Safe Launch (No Wallet/Payment, No Agent Chat)

Execution order: **security gates first**, then UI hide/removal, then release checks.

### P0 — Security and Access Controls (Blockers)
- [x] Add feature flag `FEATURE_PATIENT_WALLET_ENABLED` (default: `false`) and hard-gate wallet APIs:
  - [x] `POST /api/patient/wallet/deposit`
  - [x] `GET /api/patient/wallet/transactions`
  - [x] `POST /api/patient/wallet/pay-claim`
  - [x] Return `503` with explicit `"Wallet is temporarily disabled"` message when off.
- [x] Add `requirePatientSession` to wallet routes that are currently missing session gating.
- [x] Remove trust in body-provided `patientId` for wallet operations; resolve patient strictly from authenticated session.
- [x] Add ownership guard to `POST /api/patient/routine/daily/:id/media-link`:
  - [x] Verify `daily_entry_id` belongs to current patient/session before insert.
  - [x] Return `403` on ownership mismatch.
- [x] Add audit log events for blocked wallet access attempts and media-link ownership failures.

### P1 — Disable Chat/Agent Surfaces for Month-1
- [x] Add feature flag `FEATURE_PATIENT_CHAT_ENABLED` (default: `false`).
- [x] Hide/remove chat entry points in web UI when disabled:
  - [x] `book.html` guided chat card/CTA
  - [x] `triage.html` route access (redirect to `book.html` or `appointments.html` with notice)
  - [x] Products Learn chat input send controls (keep static "coming soon" card only)
- [x] Gate API chat endpoints when disabled:
  - [x] `POST /api/patient/triage/message`
  - [x] `GET /api/patient/triage/history`
  - [x] Return `503` with explicit `"Chat is temporarily disabled"` message when off.

### P1 — Remove Payment UX During Free-Monitoring Month
- [x] Hide wallet nav item and wallet page route in patient UI when wallet flag is off.
- [x] Remove/disable payment CTAs in appointments flow:
  - [x] Hide `Pay now` buttons
  - [x] Hide payment explanation blocks (`whyPay`)
  - [x] Replace with neutral banner: `"Billing is paused during monitoring month."`
- [x] Hide/disable `payment-success.html` user entry links where applicable.
- [x] Ensure no checkout redirects are reachable from patient pages while wallet/payments are off.

### P2 — Journal Safety Messaging and Quality Guardrails
- [x] Add confidence-tier badge in Info tab (`High`, `Partial`, `Low`) based on `resolved_count/total`.
- [x] Show explicit disclaimer when unresolved ratio is high:
  - [x] `"Ingredient interpretation is incomplete for this product."`
- [x] Replace "Clean" badge with neutral state when `total_ingredients = 0` or low-confidence summary.
- [x] Add "data source quality" copy in Learn tab (catalog raw vs enriched).

### P2 — Validation and Release Checklist
- [x] Add API tests confirming wallet/chat endpoints return disabled responses when flags are off.
- [x] Add tests for routine media-link ownership enforcement (`403` on cross-user ID).
- [x] Add Playwright checks:
  - [x] Wallet nav hidden when disabled
  - [x] No `Pay now` button visible on appointments
  - [x] Chat CTAs/routes inaccessible when disabled
- [x] Add release runbook for month-1 mode:
  - [x] required env flags
  - [x] smoke test commands
  - [x] rollback steps

