# Catalog category classification pipeline (OBF/OFF “Unclassified” cleanup)

**Purpose:** Execution checklist to shrink the large “Unclassified” bucket (~48k items) using a **scalable, auditable** pipeline: deterministic taxonomy first, keyword heuristics second, ML and human review **only** for residuals.

**Scope:** Open Beauty Facts (OBF) and Open Food Facts (OFF) product records used by scan / beautyfacts flows, including `categories_tags`, `categories_hierarchy`, product name, brands, and ingredients text; alignment between middleware normalization and landing `deriveCategoryRoute` (or shared module); metrics, tests, and rollout.

**Out of scope (unless explicitly expanded):** Full INCIName parsing, regulatory claims beyond routing buckets, and replacing `product-grade-resolver` (regulatory grade) unless routing and grade are intentionally unified.

---

## Principles (why this order)

1. **Deterministic first** — Same inputs always yield the same bucket; misclassifications are fixed by editing a map or rule, not by retraining an opaque model.
2. **Cheap at scale** — The bulk of rows should resolve in Step 1–2 without per-row API cost or manual review.
3. **Residuals only for judgment** — ML/LLM/humans target the ambiguous tail (order-of-magnitude **5–15%** until maps mature; re-measure after each release).

---

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

## Priority legend

- **P0** — Blocks trustworthy routing or blocks measurement of success
- **P1** — Strongly improves coverage or auditability soon after P0
- **P2** — Nice-to-have polish, tooling, or advanced residuals handling

---

## Definition of done (v1)

- [ ] [🟡 Partial][P0] Baseline counts documented: total rows, unclassified before/after, by source (OBF vs OFF).
- [ ] [❌ Missing][P0] Step 1 taxonomy map shipped with version identifier and change log.
- [ ] [❌ Missing][P0] Step 2 heuristics shipped, including **negative signals** (early exit to Food when dominant food ingredients appear).
- [ ] [🟡 Partial][P0] Single code path (or clearly documented dual path) for routing: server + landing agree on bucket names.
- [ ] [❌ Missing][P0] Automated tests: map entries (sample tags), heuristic edge cases, negative-signal cases, “no override when Step 1 is confident.”
- [ ] [❌ Missing][P0] Rollout plan: backfill job or on-read resolution, with safe defaults for unknown.
- [ ] [❌ Missing][P1] Step 3 queue defined: entry criteria, max queue size target, human SLA (even if “best effort” initially).

**Scan results (landing) pending work** — see **§4.1G** (wire tile copy/meta, verdict rows, layout, doc hygiene for footer CTAs).

---

## Implementation Snapshot (Updated)

Implemented and verified in first batch:

- [x] [✅ Done][P0] Created reusable audit script: `middleware-platform/scripts/audit-catalog-index-stats.cjs`.
- [x] [✅ Done][P0] Added npm scripts: `catalog:audit:index-stats` and `catalog:audit:gcs-obf`.
- [x] [✅ Done][P0] Audited GCS OBF baseline (`gs://skinandcare-media-staging/obf/raw/full/en.openbeautyfacts.org.products.csv.gz`) with `64,349` data rows.
- [x] [✅ Done][P0] Captured OBF coverage stats: `has_ingredients_text=17,955`, `has_ingredients_tags=17,945`, `has_analysis_tags=18,600`, `missing_categories_tags=38,990`.
- [x] [✅ Done][P0] Confirmed local index is dev-sized only (`products_obf_index=51`, `products_off_index=6`) and not representative of full catalog.
- [x] [✅ Done][P0] Confirmed current staging bucket exposes OBF prefix only; OFF GCS prefix not found in same bucket.

---

## 0) Baseline and data discovery (P0)

- [x] [✅ Done][P0] **Inventory sources** — Confirmed and documented in `docs/products/CATEGORY_CLASSIFICATION_BASELINE.md`: `products_obf_index`, `products_off_index`, landing OBF→OFF API merge path, and canonical fields (`categories_tags_json`, `categories_hierarchy_json`).
- [x] [✅ Done][P0] **Define “Unclassified”** — Locked v1 definition in `docs/products/CATEGORY_CLASSIFICATION_BASELINE.md` (`category_route = unknown` or missing route payload; plus tracked `unknown_by_legacy_rules`).
- [x] [✅ Done][P0] **Histogram Step 1 candidates** — Generated top unknown `categories_tags` from GCS OBF baseline and documented top 20 tags in `docs/products/CATEGORY_CLASSIFICATION_BASELINE.md`.
- [x] [✅ Done][P0] **Histogram gaps** — Captured `missing_categories_tags=38,990` and parser quality metrics (`parse_failed`) via `scripts/audit-catalog-index-stats.cjs`.
- [x] [✅ Done][P0] **Set targets** — Added v1 targets in `docs/products/CATEGORY_CLASSIFICATION_BASELINE.md` (≥50% unknown reduction target, <10% residual target).

### 0a) Data quality guardrails (P0)

- [x] [✅ Done][P0] Add barcode validity checks (normalized numeric codes, expected length range, duplicate collision handling) policy and enforcement requirement in baseline doc and resolver contract.
- [x] [✅ Done][P0] Add malformed JSON / encoding handling for `*_tags_json` fields, with explicit fallback behavior (`json_valid` guardrail checks added in `scripts/audit-catalog-index-stats.cjs`).
- [x] [✅ Done][P0] Track and report `% rows parse_failed` so coverage metrics do not hide ingestion/parse failures (`parse_failed` output in `scripts/audit-catalog-index-stats.cjs`).

---

## 1) Deterministic taxonomy map (P0)

**Goal:** Map OFF/OBF **official** `categories_tags` and `categories_hierarchy` entries to internal route buckets (e.g. cosmetic, hygiene, non_food, supplement, food, unknown). Expand far beyond substring checks for `cosmetic`, `hygiene`, `non_food` only.

- [x] [✅ Done][P0] **Normalize tag representation** — Implemented in `services/category-route-resolver.js` (`normalizeTag`, `normalizeTags`).
- [x] [✅ Done][P0] **Define internal enum** — Implemented in `taxonomy/category-route-map.v1.json` (`cosmetic`, `hygiene`, `non_food`, `food`, `supplement`, `unknown`).
- [x] [✅ Done][P0] **Author `taxonomy-tag → route` table** — Implemented in `taxonomy/category-route-map.v1.json`, seeded from high-frequency unknown tags and OFF/OBF route needs.
- [x] [✅ Done][P0] **Precedence rules** — Implemented in map `precedence` and enforced in resolver conflict resolution logic.
- [x] [✅ Done][P0] **Version the map** — Implemented `taxonomy/category-route-map.v1.json` with explicit `version`.
- [x] [✅ Done][P0] **Wire resolver** — Implemented `services/category-route-resolver.js` and wired into OBF/OFF public barcode handlers in `server.js`.
- [x] [✅ Done][P0] **Metrics** — Added route metrics (`unknown_after_map`, `resolved_by_map`, `route_counts`) to `scripts/audit-catalog-index-stats.cjs`.

### 1.5) Conflict policy (P0)

- [x] [✅ Done][P0] Define OBF vs OFF tie-break policy for same barcode when category signals disagree (`conflict_policy` in `taxonomy/category-route-map.v1.json`).
- [x] [✅ Done][P0] Define deterministic precedence: taxonomy map vs negative signals vs drug-adjacent heuristics (precedence policy encoded in map and resolver; negative/drug layers documented as downstream layers).
- [x] [✅ Done][P0] Add `change_reason` and `map_version` requirements for any route flip to keep decisions auditable (emitted by `resolveCategoryRoute` output contract).

---

## 2) Keyword and pattern heuristics — long tail (P0), including negative signals (P0)

**Goal:** Catch rows with **missing or weak tags** using name, brand, and ingredients text. Keep rules **ordered** and **short-circuiting** so cheap rules run first.

### 2a) Positive signals (examples — expand with data)

- [x] [✅ Done][P0] **Title/brand patterns** — Implemented in `taxonomy/category-route-map.v1.json` (`heuristics.positive_signals.title_or_brand`) and applied by `services/category-route-resolver.js`.
- [x] [✅ Done][P0] **Regulatory / drug-adjacent text** — Implemented in map (`heuristics.positive_signals.regulatory_drug_adjacent`) and enforced in resolver with deterministic `rule_id` output.
- [x] [✅ Done][P0] **Ingredient substring cues** — Implemented in map (`heuristics.positive_signals.ingredient_substrings`) and covered in resolver/tests.

### 2b) Negative signals (early exit — **priority**)

**Rationale:** If the first ingredients are obviously **food staples**, stop trying to force beauty/medication routing; bucket as **Food** (or appropriate food sub-route) and skip lower-priority beauty heuristics.

- [x] [✅ Done][P0] **Define “top ingredients”** — Implemented parser in `services/category-route-resolver.js` (`parseTopIngredients`) with `top_ingredients_n` from map config.
- [x] [✅ Done][P0] **Food dominance list** — Implemented strong/weak food token lists in `taxonomy/category-route-map.v1.json` and evaluated in resolver negative-signal pass.
- [x] [✅ Done][P0] **Combination guards** — Implemented in map config (`requires_weak_token_count`) and resolver logic (`neg_food_combo` rule).
- [x] [✅ Done][P0] **Explicit overrides** — Implemented: heuristic pass does not override strong taxonomy map matches (`category-route-resolver` + test `does not override strong map match with heuristics`).

### 2c) Engineering hygiene

- [x] [✅ Done][P0] **Unit tests** — Added heuristic and override tests in `middleware-platform/__tests__/category-route-resolver.test.js` (6 passing tests).
- [x] [✅ Done][P0] **Logging** — Added deterministic `rule_id` to resolver output and exposed in API payload (`category_route_rule_id`) for support/audit traces.

### 2.5) Confidence + fallback contract (P0)

- [x] [✅ Done][P0] Emit `confidence_band` (`high|medium|low`) for every resolved route (`services/category-route-resolver.js`, exposed via `category_route_confidence` in `server.js`).
- [x] [✅ Done][P0] Define low-confidence handling (`unknown` vs review queue) and enforce consistently (resolver emits `review_eligible`; queue export script uses it).
- [x] [✅ Done][P0] Add UX-safe fallback text for unknown/low-confidence results to avoid false certainty (`taxonomy/category-route-map.v1.json` fallback copy, exposed as `category_route_fallback`).

---

## 3A) Residual queue and human review (P1)

**Goal:** Only for rows still `unknown` (or low-confidence) after Step 1–2.

- [x] [✅ Done][P1] **Define queue eligibility** — Implemented in resolver contract and policy doc (`docs/products/CATEGORY_REVIEW_AND_MODEL_POLICY.md`): queue when `route=unknown`, `confidence=low`, or `review_eligible=true`.
- [x] [✅ Done][P1] **Human queue (minimum viable)** — Implemented CSV export workflow via `scripts/export-category-review-queue.cjs` and npm script `catalog:review-queue:export`.
- [x] [✅ Done][P1] **Optional ML v1** — Defined acceptance and auto-apply thresholds in `docs/products/CATEGORY_REVIEW_AND_MODEL_POLICY.md` (>=0.90 auto-apply).
- [x] [✅ Done][P1] **LLM policy (if used)** — Documented bounded policy in `docs/products/CATEGORY_REVIEW_AND_MODEL_POLICY.md` (structured output, temp 0, prompt/model logging, cost cap).
- [x] [✅ Done][P1] **Feedback loop** — Defined reviewer-correction to deterministic-map update loop in policy doc.

### 3.5) Reviewer operations (P1)

- [x] [✅ Done][P1] Define reviewer rubric with adjudication rules for disputed labels (`docs/products/CATEGORY_REVIEW_AND_MODEL_POLICY.md`).
- [x] [✅ Done][P1] Add inter-rater agreement sampling (weekly) to detect label drift (defined with target in policy doc).
- [x] [✅ Done][P1] Define SLA/backlog cap policy (max queue age/cap + escalation) in policy doc.

### 3B) Optional ML (future)

- [ ] [❌ Missing][P2] Train classifier only on high-confidence deterministic labels after at least one stable map/rule release cycle.
- [ ] [❌ Missing][P2] Add offline evaluation harness (precision/recall + confusion matrix by route) before any auto-apply.
- [ ] [❌ Missing][P2] Enable guarded auto-apply only when confidence threshold and regression guard both pass.

---

## 4) Product integration (P0–P1)

- [x] [✅ Done][P0] **Shared logic** — Middleware resolver (`services/category-route-resolver.js`) is the source of truth; landing scan now prefers server route contract to avoid client/server drift.
- [x] [✅ Done][P0] **API contract** — Barcode APIs now return route metadata: `category_route`, `category_route_source`, `category_route_confidence`, `category_route_rule_id`, `category_route_fallback`.
- [x] [✅ Done][P0] **Backfill strategy** — Selected and documented lazy recompute on read (see `docs/products/CATEGORY_ROUTE_INTEGRATION_AND_GOVERNANCE.md`).
- [x] [✅ Done][P0] **Backward compatibility** — Preserved unknown fallback and client-side derive fallback path in landing.

### 4.5) Observability and release controls (P0)

- [x] [✅ Done][P0] Build dashboard feed/report artifact: unknown rate, resolver source mix, top failing tags, and source split via `scripts/category-route-observability-report.cjs`.
- [x] [✅ Done][P0] Add alert thresholds for unknown-rate regressions and sudden route-distribution shifts via `scripts/category-route-regression-guard.cjs` (threshold args).
- [x] [✅ Done][P0] Add pre/post release comparison report (baseline vs candidate map version) using observability snapshots + regression guard compare.
- [x] [✅ Done][P0] Add golden diff gate with protected fixture via `scripts/category-route-golden-diff.cjs` + `tests/fixtures/category-route-golden.json`.

---

## 5) Quality, safety, and governance (P1)

- [x] [✅ Done][P1] **Spot-check protocol** — Defined release sampling protocol in `docs/products/CATEGORY_ROUTE_INTEGRATION_AND_GOVERNANCE.md`.
- [x] [✅ Done][P1] **Regression suite** — Added unit suite + golden fixture gate (`__tests__/category-route-resolver.test.js`, `tests/fixtures/category-route-golden.json`, `scripts/category-route-golden-diff.cjs`).
- [x] [✅ Done][P1] **Documentation** — Added integration/governance doc + review/model policy + baseline references.
- [x] [✅ Done][P1] **Privacy** — Documented field-level privacy boundary (catalog fields only, no patient identifiers) in governance doc.

---

## 6) Rollout checklist (P0)

- [x] [✅ Done][P0] Stage map + heuristics in dev; compare histogram to baseline (implemented and runnable via `npm run catalog:rollout:check` and observability snapshot artifacts).
- [~] [🟡 Partial][P0] Deploy to staging; run E2E scan suite + API health checks (runbook + commands added; environment deploy execution remains pending).
- [~] [🟡 Partial][P0] Production deploy with feature flag or map version flag if available (implemented flags: `CATEGORY_ROUTE_MAP_FILE`, `CATEGORY_ROUTE_SHADOW_MAP_FILE`, `CATEGORY_ROUTE_CANARY_PERCENT`, `CATEGORY_ROUTE_MODE`; production rollout pending).
- [~] [🟡 Partial][P0] Post-deploy: unclassified count dashboard or one-off SQL report within 24–48 hours (report script added; production post-deploy run pending).

### 6.5) Rollback and ownership (P0)

- [x] [✅ Done][P0] Add rollback procedure to previous map version (documented in `docs/products/CATEGORY_ROUTE_ROLLOUT_RUNBOOK.md` and validated with rollout check flow).
- [x] [✅ Done][P0] Add shadow mode (compute-only) and canary rollout stage before full exposure (implemented env-controlled rollout in API + runbook).
- [x] [✅ Done][P0] Assign taxonomy route DRI and weekly review cadence for map/rule updates (defined in rollout runbook ownership section).

---

## References in repo (starting points)

- Landing routing today: `unified-dashboard/littlelab-landing/src/scanInsights.js` (`deriveCategoryRoute`).
- OBF normalization: `middleware-platform/services/open-beauty-facts-service.js`.
- OFF normalization: `middleware-platform/services/open-food-facts-service.js`.
- Regulatory-style grading (related but separate axis): `middleware-platform/services/product-grade-resolver.js`.
- Index tables: `middleware-platform/migrations/026_obf_ingestion_index_tables.js`, `middleware-platform/migrations/036_products_off_index_tables.js`.

---

## Open questions (resolve during §0)

- [x] [✅ Decided][P0] **Food is a first-class route everywhere** (not only when OFF wins). Final route classification is source-agnostic at output layer.
- [ ] Single global map vs **locale-specific** map rows for non-`en:` tags?
- [ ] Persist resolved route on index rows vs compute at read time?

### Accepted policy (locked)

- [x] [✅ Accepted][P0] **Top-level route enum (shared across OBF/OFF):** `food`, `beauty`, `hygiene`, `supplement`, `non_food`, `unknown`.
- [x] [✅ Accepted][P0] **Subtype remains optional** for richer UX/analytics and does not replace top-level route.
- [x] [✅ Accepted][P0] **Source provenance remains explicit** and separate from final route.

### API field contract (accepted names)

- [x] [✅ Accepted][P0] `category_route_top` — required top-level route using shared enum above.
- [x] [✅ Accepted][P0] `category_route_subtype` — optional finer route detail (for example: `snacks_sweets`, `suncare`).
- [x] [✅ Accepted][P0] `category_route_confidence` — `high` | `medium` | `low`.
- [x] [✅ Accepted][P0] `category_route_source` — resolver path (`taxonomy_map` | `heuristic` | `ml` | `human` | `unknown`).
- [x] [✅ Accepted][P0] `facts_source` — data catalog provenance (`open_beauty_facts` | `open_food_facts`).

---

## Phase 2) Unknown backlog reduction (post-v1 hardening)

**Purpose:** Reduce remaining unknowns safely by triaging backlog tags into mapping vs normalization vs suppression lanes, with measurable and auditable batch releases.

### Phase 2A) Lock measurement first (P0)

- [x] [✅ Done][P0] Freeze one official baseline command + args for before/after (single audit pathway) via `taxonomy/category-phase2-measurement-lock.v1.json`.
- [x] [✅ Done][P0] Freeze one resolver/map RC version per comparison window (no moving-target comparisons) in measurement lock + baseline freeze artifact.
- [x] [✅ Done][P0] Use one frozen dataset per release train for metric comparisons (`OBF_GCS_BASELINE_URI` in measurement lock).
- [x] [✅ Done][P0] Publish baseline metrics snapshot (`total_rows`, `unknown_rows`, `unknown_rate`, `route_distribution`, `parse_failed`) via `scripts/category-phase2-baseline-freeze.cjs`.
- [x] [✅ Done][P0] Enforce rule: no improvement claim unless same command + same dataset + same RC version (documented in measurement lock rules and guide).

### Phase 2B) Backlog triage lanes (P0)

- [x] [✅ Done][P0] Add triage columns to backlog (`triage_class`, `proposed_action`, `proposed_route`, `owner`, `status`, `batch_id`) via `scripts/category-backlog-triage-template.cjs`.
- [x] [✅ Done][P0] Classify each tag into one lane only (enforced policy in `docs/products/CATEGORY_PHASE2_IMPLEMENTATION_GUIDE.md`):
  - `real_category` -> taxonomy map
  - `alias_translation` -> alias/normalization table
  - `meta_noise` -> suppression list
  - `manual_review` -> review queue
- [x] [✅ Done][P0] Prioritize triage by frequency (top 100 first), but map only `real_category` (documented and supported by `scripts/category-batch-prepare.cjs`).
- [x] [✅ Done][P0] Enforce strict rule: `alias_translation` is narrow and deterministic; meta/noise tags are not allowed in alias lane (policy locked in Phase 2 guide).

### Phase 2C) Normalization and suppression controls (P0)

- [x] [✅ Done][P0] Build/maintain alias table for locale variants and canonicalization (`fr:*`, spacing/hyphen variants) in `taxonomy/category-route-aliases.v1.json`.
- [x] [✅ Done][P0] Build/maintain explicit suppression list for metadata/noise tags (`open-beauty-facts`, `non-open-products-facts`, etc.) in `taxonomy/category-route-suppression.v1.json`.
- [x] [✅ Done][P0] Ensure suppressed tags are excluded from route signal scoring (implemented in `normalizeTags` in resolver).
- [x] [✅ Done][P0] Add deterministic unit tests for alias and suppression behavior (`__tests__/category-route-resolver.test.js`).

### Phase 2D) Controlled batch mapping loop (P0)

- [x] [✅ Done][P0] Apply map updates in small batches (25-50 tags), never bulk top-to-bottom (workflow supported by `scripts/category-batch-prepare.cjs --limit`).
- [x] [✅ Done][P0] Run full gate after every batch (unit, golden, observability, regression guard) via `scripts/category-route-rollout-check.cjs`.
- [x] [✅ Done][P0] Record unknown delta and route-shift delta after each batch via `scripts/category-batch-record-metrics.cjs`.
- [x] [✅ Done][P0] Keep heuristics and rollout config frozen during map-only batches for attribution clarity (documented in Phase 2 guide).

### Phase 2E) Plateau / stop criteria (P0)

- [x] [✅ Done][P0] Define stop rule: pause mapping when per-batch unknown reduction falls below target (implemented check in `scripts/category-plateau-check.cjs`).
- [x] [✅ Done][P0] Define stop rule: pause mapping when route-shift risk exceeds threshold (regression guard + documented criteria in guide).
- [x] [✅ Done][P0] Define escalation path when plateau is reached (documented: shift residuals to manual review / optional ML feasibility check).

### Phase 2F) Ownership and auditability (P0)

- [x] [✅ Done][P0] Assign owner for each batch (`batch_id`, DRI, reviewer) in triage workflow + changelog template.
- [x] [✅ Done][P0] Require changelog per batch (`tags_added`, `aliases_added`, `suppressed_tags`, rationale, metrics delta) via `docs/products/CATEGORY_PHASE2_BATCH_CHANGELOG_TEMPLATE.md`.
- [x] [✅ Done][P0] Require release note entry linking map version to batch changelog and regression evidence (documented in Phase 2 guide).

### Phase 2G) Staging, canary, and post-deploy evidence (P0)

- [~] [🟡 Partial][P0] Stage first, shadow compare with canary=0, and verify no route-field regressions (implemented script `scripts/category-staging-route-field-check.cjs`; staging environment run pending).
- [~] [🟡 Partial][P0] Canary ramp only when unknown and route-shift guards pass (5% -> 20% -> 50% -> 100%) (runbook + guard scripts in place; staging/prod execution pending).
- [~] [🟡 Partial][P0] Post-deploy report within 24-48h using frozen baseline method; include unknown delta and top route shifts (`scripts/category-postdeploy-report.cjs` implemented; real post-deploy run pending).

---

## Phase 3) Scan path + pipeline production hardening (new)

**Purpose:** Close the remaining gaps between scan UX and resolver data pipeline so rollout decisions are trustworthy and barcode lookup/classification states are clear to users.

### Phase 3A) Eliminate client/server route drift in scan path (P0)

- [x] [✅ Done][P0] Update `useAssistantSession.sendUserMessage` barcode branch to prefer server route contract (`facts.category_route`) instead of local `deriveCategoryRoute(...)`.
- [x] [✅ Done][P0] Keep client `deriveCategoryRoute` as explicit fallback only when server route fields are absent; add telemetry counter for fallback usage (`scan.category_route.client_fallback_used`).
- [x] [✅ Done][P0] Add frontend test coverage for both scan entry paths (`ingestScannedBarcode` and `sendUserMessage`) asserting identical route/source/confidence behavior for the same mocked product (`useAssistantSession.routeParity.test.jsx`).
- [x] [✅ Done][P0] Add a regression fixture with a known `unknown` barcode to ensure “found product + unknown route” is handled consistently (`middleware-platform/test-fixtures/scan-state-barcodes.json`).

### Phase 3B) Lock and unify API contract + enum names (P0)

- [x] [✅ Done][P0] Resolve the naming mismatch between accepted policy fields (`category_route_top`, etc.) and live payload fields (`category_route`, etc.); choose one canonical contract (`docs/products/CATEGORY_ROUTE_API_CONTRACT.md`).
- [x] [✅ Done][P0] Resolve enum mismatch (`beauty` vs `cosmetic`) and publish a migration decision (alias strategy, deprecation window, and analytics mapping) in contract doc.
- [x] [✅ Done][P0] Update middleware response schema docs and landing consumption docs to the final locked contract.
- [x] [✅ Done][P0] Add compatibility tests to prevent reintroduction of mixed field names across OBF/OFF endpoints (`__tests__/category-route-api-contract.test.js`).

### Phase 3C) Make rollout guard representative (P0)

- [x] [✅ Done][P0] Replace small local DB-only guard baseline with a frozen representative sample artifact (or larger deterministic sample) tied to release train (baseline+sensitivity artifacts generated and CI artifact upload wired).
- [x] [✅ Done][P0] Version and store baseline metadata (`sample source`, `sample size`, `map version`, `generated_at`) next to guard reports (`scripts/category-guard-baseline-freeze.cjs`).
- [x] [✅ Done][P0] Add a “guard sensitivity check” script to compare local sample shift vs full-baseline trend before rollout decisions (`scripts/category-guard-sensitivity-check.cjs`).
- [x] [✅ Done][P0] Keep threshold unchanged until representativeness evidence is documented (guard evidence outputs captured in `middleware-platform/tmp` and CI artifact flow).

### Phase 3D) Unknown UX behavior for successful barcode lookups (P1)

- [x] [✅ Done][P1] Add explicit scan copy/state for “barcode found, category unknown” distinct from “barcode not found”.
- [x] [✅ Done][P1] Ensure UI still enables ingredient-based analysis path when category is unknown but ingredients are present.
- [x] [✅ Done][P1] Add telemetry: `scan.lookup_found_route_unknown.count`, `scan.lookup_found_route_known.count`, `scan.lookup_not_found.count`.
- [x] [✅ Done][P1] Add QA script with sample barcodes across states (known, unknown, not_found, sparse_data) and expected CTAs (`scripts/category-scan-state-qa.cjs` + fixture).

### Phase 3E) Data completeness lane (root-cause reduction) (P0)

- [x] [✅ Done][P0] Build a dedicated backlog export for unknowns missing both `product_name` and `ingredients_text` (highest blocker cohort) (`scripts/category-missing-both-backlog-export.cjs`).
- [x] [✅ Done][P0] Add enrichment playbook: source re-fetch policy, OFF fallback policy, OCR/manual ingestion policy, and dedupe rules (`docs/products/CATEGORY_DATA_COMPLETENESS_PLAYBOOK.md`).
- [x] [✅ Done][P0] Define KPIs for this lane: `% unknown missing both`, `% unknown with ingredients`, and weekly delta targets (`scripts/category-data-completeness-kpi.cjs`).
- [x] [✅ Done][P0] Block “problem solved” claim until missing-both cohort is below agreed threshold (documented in playbook exit criteria).

### Phase 3F) Controlled release slicing for heuristic expansions (P0)

- [x] [✅ Done][P0] Continue split-release policy: deterministic tags -> aliases -> small heuristic chunk; never batch broad title expansions with map/alias updates (policy retained and documented in this phase).
- [x] [✅ Done][P0] Keep `title_cosmetic_core` disabled until it passes its own guard slice or is narrowed into sub-rules with measurable impact.
- [x] [✅ Done][P0] Require per-slice evidence table (unknown delta, route-shift deltas, pass/fail) before merging next slice (`scripts/category-slice-evidence-record.cjs`).
- [x] [✅ Done][P0] Record each slice in changelog with exact rule IDs changed (slice evidence recorder supports explicit rule-id field).

### Phase 3G) Refactor duplicated scan endpoint logic (P1)

- [x] [✅ Done][P1] Extract shared route/quality/ingredient-flag response builder for OBF/OFF handlers to reduce divergence risk (`services/scan-route-response.js`).
- [x] [✅ Done][P1] Add shared tests asserting parity of route fields between `/beautyfacts/:barcode` and `/foodfacts/:barcode` (`__tests__/category-route-api-contract.test.js`).
- [x] [✅ Done][P1] Keep source-specific lookup behavior separate, but route contract identical (shared payload builder + endpoint-specific fetch logic retained).

---

## Phase 4) Scan-to-results UX redesign + decision quality (new)

**Purpose:** Deliver a modern results experience with a contract grounded in real server capability today (raw catalog + deterministic enrichments), then layer reasoning safely later.

### Phase 4.1) Before agentic reasoning (P0 first) — deterministic baseline

**Execution rule:** Complete backend + frontend + QA tasks in 4.1 before enabling reasoning-driven tiles or recommendations.

#### 4.1A) Backend contract split (`scan_summary` vs `result_summary`) (P0)

- [x] [✅ Done][P0] Add `scan_summary` to barcode response for deterministic, non-personalized tiles only.
- [x] [✅ Done][P0] Add/extend `result_summary` in snapshot response for session-aware fields and verdicts.
- [x] [✅ Done][P0] Use common tile envelope for all tiles:
  - `status`: `available | unavailable | deferred`
  - `source`: `deterministic | graph | reasoning | none`
  - `confidence`: `high | medium | low | null`
  - `value`
  - `reason_unavailable`: `missing_ingredients | sparse_data | no_profile_context | no_scoring_pipeline | reasoning_disabled | category_unknown`
- [x] [✅ Done][P0] Include provenance metadata (`generated_at`, `resolver_source`, `route_rule_id`, `catalog_source`, `schema_version`) on summaries.
- [x] [✅ Done][P0] Keep contract backward-compatible for existing clients (old fields remain until deprecation window closes).

#### 4.1B) Backend deterministic computation lane (P0)

- [x] [✅ Done][P0] Build `key_actives` deterministic extractor from `ingredients_text` using a managed actives dictionary (name + optional concentration parse).
- [x] [✅ Done][P0] Build `formulation` deterministic classifier (water/oil/emulsion/unknown) from top ingredient cues.
- [x] [✅ Done][P0] Build `function` mapping from extracted actives + category route with confidence bands.
- [x] [✅ Done][P0] Populate `skin_type` as `deferred/no_profile_context` at scan layer; attempt graph/session-derived value in result layer.
- [x] [✅ Done][P0] Populate `safety_score` as `deferred/no_scoring_pipeline` until scoring model exists.
- [x] [✅ Done][P0] Define strict “do not fabricate” policy: missing signals must yield `unavailable`/`deferred`, never guessed numeric outputs.

#### 4.1C) Frontend UI modernization (P0)

- [x] [✅ Done][P0] Redesign results UI to match target IA: hero card + structured tiles + verdict block + bottom actions.
- [x] [✅ Done][P0] Render tile states from envelope (`available/unavailable/deferred`) with explicit fallback copy.
- [x] [✅ Done][P0] Add explicit scan state cards for `found+known`, `found+unknown`, `not_found`, `sparse_data`, `manual_ingredients`.
- [x] [✅ Done][P0] Ensure `sendUserMessage` and `ingestScannedBarcode` produce identical `scanResult` shape and route metadata.
- [x] [✅ Done][P0] Keep mobile-first parity (iOS Safari + Android Chrome) with accessibility checks for dense card layouts (mobile visual/accessibility regression spec added: `e2e/landing-results-visual.spec.cjs`).

#### 4.1D) User-question coverage (P0)

- [x] [✅ Done][P0] Implement deterministic “Is this good for me?” verdict in `result_summary.verdict.good_for_me` with evidence + confidence.
- [x] [✅ Done][P0] Implement deterministic/graph “Is this harmful?” severity + evidence in `result_summary.verdict.harmful`.
- [x] [✅ Done][P0] Implement Phase-1 alternatives policy:
  - fallback policy: `ask_kelly` when confidence/data are insufficient
  - optional deterministic alternatives only when confidence thresholds are met.
- [x] [✅ Done][P0] Add explicit “informational_only” disclaimer on verdict block.

#### 4.1E) Quality, rollout, and observability (P0)

- [x] [✅ Done][P0] Add backend unit tests for each tile computer + missing-signal fallback semantics.
- [x] [✅ Done][P0] Add frontend contract tests for all tile states and invalid/missing server fields.
- [x] [✅ Done][P0] Add visual regression snapshots for key results states against approved design references (`e2e/landing-results-visual.spec.cjs`).
- [x] [✅ Done][P0] Add metrics for summary coverage (`tile_available_rate` by tile) and fallback usage (scan/result tile availability + reason metrics emitted via Metrics).
- [x] [✅ Done][P0] Roll out behind feature flag with canary and rollback switch (`SCAN_SUMMARY_V1`, `RESULT_SUMMARY_V1`, `REACT_APP_RESULTS_SUMMARY_V1`).

#### 4.1F) Scan results conversion redesign (P0, new)

- [x] [✅ Done][P0] Add Playwright evidence note + artifact links for current-state scan UX audit (`results_visible` pass, low-emphasis results strip, hero image reliability issue).  
  Evidence: `docs/testing/SCAN_RESULTS_UI_AUDIT_EVIDENCE.md`
- [x] [✅ Done][P0] Replace low-emphasis results strip with premium “decision cockpit” layout (mobile-first) and ensure visual hierarchy is above marketing content.
- [x] [✅ Done][P0] Add top hero summary card with: product image, product name, category, one-line “what it does,” confidence pill, source badge, floating quick tags.
- [x] [✅ Done][P0] Redesign structured center tiles with icon-rich cards for: Key Actives, Function, Skin Type Fit, Formulation, Safety Score (deferred state allowed, no fabricated score).
- [x] [✅ Done][P0] Add explicit decision answers block that always addresses:
  - product + what it does
  - is this good for me (benefits)
  - harmful ingredients
  - good for children
  - alternatives I can use
- [x] [✅ Done][P0] Add deterministic child-safety output lane (`safe | caution | insufficient_data`) with evidence text and clear fallback when data is missing.
- [x] [✅ Done][P0] Add alternatives panel with deterministic candidates when confidence passes threshold; otherwise route to `ask_kelly` fallback.
- [x] [✅ Done][P0] Add “missing more” conversion layer copy/UX:
  - unlock personal-fit mode (age, sensitivity, routine conflicts)
  - unlock pediatric confidence mode
  - compare to safer alternatives in one tap
- [x] [✅ Done][P0] Add sticky bottom action row: primary **Done**, secondary **Ask Agent**, optional **See alternatives** (when deterministic alternative candidates exist).
- [x] [✅ Done][P0] Apply premium visual style system: dense rounded cards, semantic icon colors, layered depth/shadows/gradients, high-contrast typography, polished spacing.

#### 4.1G) Scan results UI — pending follow-ups (P0–P2)

**Context:** §4.1G shipped: `AssistantResultsPage.jsx` uses **`TileArticle`** + **`formatTileBody`** / **`formatTileMeta`** for tiles; **`buildResultSummary`** emits **`verdict.side_effects`** (deterministic stub under no-fabrication). Layout: **2×2** formulation grid + **full-width** safety row; verdict includes side effects, **children_safe.summary**, and structured **alternatives**.

**Suggested implementation order:** **(A)** wire copy + meta → **(B)** verdict (`side_effects`, `children_safe.summary`, alternatives shape) → **(C)** layout/visual hierarchy.

- [x] [✅ Done][P0] **Wire `formatTileBody(tile)`** in the tile grid JSX for every non-`available` state (including `deferred`); do not render raw `reason_unavailable` strings.
- [x] [✅ Done][P0] **Human tile meta** — add `formatTileMeta(tile)` (or equivalent): map `source` (`deterministic`, `graph`, `none`, `reasoning`, …) and `confidence` to user-facing phrases; **omit** the meta line when there is nothing useful (avoid empty rows).
- [x] [✅ Done][P0] **Complete `TILE_REASON_COPY`** (or fallback rules) for all `reason_unavailable` codes the API can emit (including `not_applicable_cosmetic_*`, `sparse_data`, `reasoning_disabled`, etc., per contract).
- [x] [✅ Done][P0] **Tests** — extend `AssistantResultsPage.test.jsx` (and accessibility tests if needed) so tile body/meta do not assert or display raw snake_case enums for typical OFF/OBF scan snapshots.
- [x] [✅ Done][P1] **Verdict — “Side effects” row** — add a sixth Q/A row: render `result_summary.verdict.side_effects` when the backend supplies it; otherwise show a **deterministic stub** (e.g. “Not assessed in this scan”) until `buildResultSummary` in `middleware-platform/services/product-summary-service.js` emits real content under a **no-fabrication** policy.
- [x] [✅ Done][P1] **Verdict — `children_safe`** — surface **`summary`** (explanatory text) alongside **`answer`** where the server provides it.
- [x] [✅ Done][P1] **Verdict — alternatives** — align UI with the structured `alternatives` object from `buildDeterministicAlternatives` / API; keep **Ask Agent** (or policy fallback) when there are no candidates.
- [x] [✅ Done][P2] **Layout / IA** — refactor toward reference hierarchy: floating callouts on hero, sheet-style product header, **2×2** grid for Key Actives / Function / Skin Type / Formulation, **full-width** deferred safety score, then decision answers + full ingredient line (see design prototype / `scan_results_redesign.html` for structure; keep current **Done** / **Ask Agent** CTAs).
- [x] [✅ Done][P2] **Doc hygiene** — replace §4.1F sticky-footer bullet above with shipped CTAs: primary **Done**, secondary **Ask Agent**, optional **See alternatives** (supersede **Fix results** / **Use this product** / **Ask Kelly** as listed in the old bullet).

### Phase 4.2) After agentic reasoning (P1 after 4.1) — reasoning augmentation

**Execution rule:** Enable only after deterministic baseline is stable, rollout-safe, and tile coverage metrics are healthy.

#### 4.2A) Backend reasoning augmentation contract (P1)

- [ ] [❌ Missing][P1] Allow reasoning to upgrade only permitted fields (explanations, alternatives, skin-type rationale), not overwrite deterministic provenance fields silently.
- [ ] [❌ Missing][P1] Add reasoning provenance fields (`reasoning_model`, `reasoning_version`, `reasoning_evidence_refs`) in `result_summary`.
- [ ] [❌ Missing][P1] Add reasoning confidence gate per field; below threshold must revert to deterministic/deferred state.
- [ ] [❌ Missing][P1] Add safety guardrails to block over-claiming and diagnosis language in consumer UI responses.

#### 4.2B) Frontend reasoning UX integration (P1)

- [ ] [❌ Missing][P1] Visually separate deterministic facts vs reasoning-derived recommendations (“why this answer” panel).
- [ ] [❌ Missing][P1] Add explicit “reasoning unavailable” fallback behavior when reasoning is disabled or low-confidence.
- [ ] [❌ Missing][P1] Add alternatives module fed by reasoning only when confidence and policy checks pass.

#### 4.2C) Reasoning QA + governance (P1)

- [ ] [❌ Missing][P1] Add eval set for recommendation quality (`good_for_me`, `harmful`, `alternatives`) with pass thresholds.
- [ ] [❌ Missing][P1] Add hallucination/unsupported-claim checks in CI for reasoning responses.
- [ ] [❌ Missing][P1] Track post-launch reasoning KPIs (acceptance, deflection, dissatisfaction/correction rate).
- [ ] [❌ Missing][P1] Keep one-click kill switch to deterministic mode.
