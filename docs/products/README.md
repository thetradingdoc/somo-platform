# products — consolidated documentation

**Single file:** All former `docs/products/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Category Classification Baseline (Phase 0) (`CATEGORY_CLASSIFICATION_BASELINE.md`)](#category-classification-baseline)
- [Category Data Completeness Playbook (`CATEGORY_DATA_COMPLETENESS_PLAYBOOK.md`)](#category-data-completeness-playbook)
- [Category Phase 2 Batch Changelog Template (`CATEGORY_PHASE2_BATCH_CHANGELOG_TEMPLATE.md`)](#category-phase2-batch-changelog-template)
- [Category Phase 2 Implementation Guide (`CATEGORY_PHASE2_IMPLEMENTATION_GUIDE.md`)](#category-phase2-implementation-guide)
- [Category Review and Model Policy (v1) (`CATEGORY_REVIEW_AND_MODEL_POLICY.md`)](#category-review-and-model-policy)
- [Category Route API Contract (Locked) (`CATEGORY_ROUTE_API_CONTRACT.md`)](#category-route-api-contract)
- [Category Route Integration and Governance (`CATEGORY_ROUTE_INTEGRATION_AND_GOVERNANCE.md`)](#category-route-integration-and-governance)
- [Category Route Rollout Runbook (`CATEGORY_ROUTE_ROLLOUT_RUNBOOK.md`)](#category-route-rollout-runbook)
- [CBD Medical Knowledge Summary for Voice Agent (`cbd-medical-knowledge-summary.md`)](#cbd-medical-knowledge-summary)
- [CBD Product Analysis & Medical Information Research (`cbd-product-analysis.md`)](#cbd-product-analysis)
- [Open Beauty Facts (global) — API data model & categorization (`OPEN_BEAUTY_FACTS_DATA_MODEL.md`)](#open-beauty-facts-data-model)
- [Product Inventory List (`PRODUCT_LIST.md`)](#product-list)
- [Products Documentation (`README.md`)](#readme)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="category-classification-baseline"></a>

## Category Classification Baseline (Phase 0)

*Former path: `docs/products/CATEGORY_CLASSIFICATION_BASELINE.md`*

## Scope

- Catalog sources: OBF and OFF index tables (`products_obf_index`, `products_off_index`)
- API merge path: landing barcode flow tries OBF first, then OFF fallback
- Current UI unclassified behavior: route resolves to `unknown` when no matching category rule exists

## Definition of "Unclassified" (locked for v1)

For baseline and KPI reporting, **unclassified** means:

- `category_route = "unknown"` after current route resolver logic, OR
- no route assigned in API payload when routing is expected.

For historical comparison to current landing behavior, we also track:

- `unknown_by_legacy_rules`: legacy route function using substring checks (`cosmetic|hygiene|non_food`) on `categories_tags`.

## Baseline Counts (captured)

### GCS OBF baseline file

- Source: `gs://skinandcare-media-staging/obf/raw/full/en.openbeautyfacts.org.products.csv.gz`
- Data rows: `64,349`
- `ingredients_text` present: `17,955`
- `ingredients_tags` present: `17,945`
- `ingredients_analysis_tags` present: `18,600`
- `categories_tags` missing: `38,990` (60.6%)
- `unknown_by_legacy_rules`: `51,243`

### Local dev SQLite snapshot (reference only)

- `products_obf_index`: 51 rows
- `products_off_index`: 6 rows

This local sample is not representative of full catalog distribution and should not be used for KPI targets.

## Unclassified Candidate Histogram (OBF, legacy unknown slice)

Top category tags among legacy-unknown rows:

1. `en:hair` (2000)
2. `en:shampoos` (1661)
3. `en:body` (926)
4. `en:face` (880)
5. `en:suncare` (522)
6. `en:in-sun-protections` (479)
7. `en:open-beauty-facts` (466)
8. `en:sunscreen` (449)
9. `en:non-open-products-facts` (416)
10. `en:facial-creams` (379)
11. `en:makeup` (352)
12. `en:body-creams` (326)
13. `en:hand-creams` (289)
14. `en:hair-care` (238)
15. `en:accessories` (224)
16. `en:cleansers` (223)
17. `en:hair-conditioners` (214)
18. `en:perfumes` (184)
19. `en:lip-balms` (172)
20. `en:anti-dandruff-shampoos` (157)

## Targets (v1)

- Reduce unclassified rate by at least 50% vs legacy baseline on OBF feed.
- Keep residual (unknown + low confidence) under 10% after map + heuristic pass.
- Keep route flip regressions in protected golden barcode set under 1% per release (or explicit approved exceptions).

## Notes / Known Gaps

- OFF full baseline GCS object is not yet available in the same staging bucket.
- OFF-specific nutritional metadata (`nova_group`, `nutriscore_grade`) is not stored in current OFF index schema and requires separate ingestion if needed for route policy.


---

<a id="category-data-completeness-playbook"></a>

## Category Data Completeness Playbook

*Former path: `docs/products/CATEGORY_DATA_COMPLETENESS_PLAYBOOK.md`*

## Scope

This playbook covers the highest blocker cohort: records where route is `unknown` and both `product_name` and `ingredients_text` are missing.

## Enrichment Policy

1. **Source re-fetch**
   - Retry upstream pull for stale records first.
   - Do not overwrite richer local data with emptier upstream payloads.

2. **OFF fallback**
   - If OBF lookup is sparse, attempt OFF cross-lookup by barcode.
   - Keep source provenance in output (`data_source`, `resolved_catalog`).

3. **OCR/manual ingestion**
   - For unresolved scans, allow label OCR/manual ingredient entry path.
   - Mark rows with ingestion source for auditability.

4. **Deduping**
   - Deduplicate by normalized barcode.
   - Keep latest non-empty product profile when duplicates disagree.

## KPIs

- `% unknown missing both`
- `% unknown with ingredients`
- Weekly delta target for each KPI (set per sprint).

## Exit Criteria

Do not mark backlog solved while missing-both unknown cohort remains above agreed threshold.


---

<a id="category-phase2-batch-changelog-template"></a>

## Category Phase 2 Batch Changelog Template

*Former path: `docs/products/CATEGORY_PHASE2_BATCH_CHANGELOG_TEMPLATE.md`*

- Batch ID:
- Map version:
- Date:
- DRI:
- Reviewer:

## Scope

- Triaged rows considered:
- Approved real-category tags:
- Alias additions:
- Suppressed tags:

## Changes

- `tags_added`:
- `aliases_added`:
- `suppressed_tags`:
- Rationale:

## Evidence

- Baseline lock file:
- Candidate observability file:
- Unknown delta:
- Route-shift summary:
- Golden diff result:
- Unit test result:

## Decision

- Go / No-Go:
- Notes:


---

<a id="category-phase2-implementation-guide"></a>

## Category Phase 2 Implementation Guide

*Former path: `docs/products/CATEGORY_PHASE2_IMPLEMENTATION_GUIDE.md`*

## Lane Separation Rules

- `real_category` -> taxonomy map only.
- `alias_translation` -> alias file only (narrow deterministic canonicalization).
- `meta_noise` -> suppression list only.
- `manual_review` -> review queue only.

**Important:** `alias_translation` must not become a dumping ground for meta/noise tags.

## Required Command Order (Frozen Measurement)

1. Freeze baseline:
   - `npm run catalog:phase2:baseline:freeze`
2. Generate backlog + triage template:
   - `npm run catalog:unknown:backlog`
   - `npm run catalog:backlog:triage-template`
3. Prepare a limited approved batch (25-50):
   - `npm run catalog:batch:prepare -- --batch-id <id> --limit 50`
4. Run gates:
   - `npm run catalog:golden:diff`
   - `npm run test:session-orchestration` (or equivalent)
   - `npm run catalog:rollout:check`
5. Generate postdeploy-style comparison:
   - `npm run catalog:postdeploy:report`

## Plateau / Stop Criteria

- Stop map expansion when unknown reduction per batch is below threshold for two consecutive batches.
- Stop and investigate if route-shift guard fails or repeatedly nears threshold.

## Ownership and Auditability

- Every batch requires:
  - DRI
  - reviewer
  - batch changelog
  - linked evidence artifacts

Use:

- `docs/products/README.md#category-phase2-batch-changelog-template`


---

<a id="category-review-and-model-policy"></a>

## Category Review and Model Policy (v1)

*Former path: `docs/products/CATEGORY_REVIEW_AND_MODEL_POLICY.md`*

## Queue Eligibility

A row is eligible for manual review when any condition is true:

- `route = unknown`
- `confidence_band = low`
- `review_eligible = true` from resolver output

Queue export command:

- `npm run catalog:review-queue:export`

Output includes source, barcode, suggested route, confidence, and top tags for reviewer context.

## Human Review Rubric

Reviewers must assign one final route from:

- `cosmetic`
- `hygiene`
- `non_food`
- `food`
- `supplement`
- `unknown`

Adjudication rules:

1. Prefer explicit official taxonomy tags over inferred text patterns.
2. If no reliable tags exist, use product title + top ingredient tokens.
3. If signals conflict and confidence is low, keep `unknown` and escalate for lead review.
4. Record the final decision reason in one sentence.

## Inter-rater Agreement

- Weekly sample: 50 reviewed rows.
- Two reviewers independently label each sample.
- Target agreement: >= 90%.
- If below threshold, freeze map changes and run calibration session.

## SLA and Backlog Cap

- Standard SLA: 3 business days.
- Critical queue cap: < 1000 unresolved rows older than 7 days.
- Escalation: if cap exceeded, assign temporary DRI and prioritize high-impact tags.

## Optional ML v1 Policy

- Train only on high-confidence deterministic labels.
- Auto-apply only when confidence >= 0.90.
- For 0.60-0.89, enqueue for human review.
- For < 0.60, keep `unknown`.

## LLM Policy (if used)

- Structured output only (JSON schema).
- Temperature: 0.
- No free-form user-facing claims.
- Log model version + prompt hash + timestamp for every classification attempt.
- Daily cost cap enforced by job runner budget.

## Feedback Loop

- Weekly ingest reviewer corrections.
- Convert repeated reviewer overrides into deterministic map/rule updates first.
- Re-train ML only after deterministic updates are applied.


---

<a id="category-route-api-contract"></a>

## Category Route API Contract (Locked)

*Former path: `docs/products/CATEGORY_ROUTE_API_CONTRACT.md`*

## Canonical Route Enum

- `cosmetic`
- `hygiene`
- `food`
- `supplement`
- `non_food`
- `unknown`

`beauty` is deprecated and should only be handled as a legacy analytics alias.

## Canonical Response Fields

Barcode endpoints (`/api/public/beautyfacts/:barcode`, `/api/public/foodfacts/:barcode`) must return:

- `category_route`
- `category_route_source`
- `category_route_confidence`
- `category_route_rule_id`
- `category_route_fallback`
- `category_route_map_version`
- `category_route_rollout_mode`
- `category_route_canary_applied`
- `category_route_shadow` (optional object)

Legacy alternate keys such as `category_route_top` are not part of the contract.

## Client Consumption Rule

Landing should treat `category_route` as authoritative when it is a valid enum value (including `unknown`).
Client derivation is fallback-only for absent/invalid server values.


---

<a id="category-route-integration-and-governance"></a>

## Category Route Integration and Governance

*Former path: `docs/products/CATEGORY_ROUTE_INTEGRATION_AND_GOVERNANCE.md`*

## Step 4 Integration Decisions

- Shared logic lives in middleware resolver: `services/category-route-resolver.js`.
- Landing scan now prefers server contract fields:
  - `category_route`
  - `category_route_source`
  - `category_route_confidence`
  - `category_route_rule_id`
  - `category_route_fallback`
- Client-side derive remains as backward-compatible fallback only.

## API Contract (v1)

Public barcode responses include:

- `category_route`
- `category_route_source` (`taxonomy_map` | `heuristic`)
- `category_route_confidence` (`high` | `medium` | `low`)
- `category_route_rule_id` (deterministic resolver rule)
- `category_route_fallback` (safe copy for unknown/low confidence)

## Backfill Strategy

- Strategy selected: **lazy recompute on read** (current API request path).
- Optional next step: nightly snapshot materialization to a reporting table.
- Unknown remains valid fallback for compatibility.

## Step 4.5 Observability and Release Controls

Commands:

- Build observability snapshot:
  - `node scripts/category-route-observability-report.cjs`
- Compare baseline vs candidate with thresholds:
  - `node scripts/category-route-regression-guard.cjs --baseline <file> --candidate <file>`
- Golden diff gate for protected barcode fixture:
  - `node scripts/category-route-golden-diff.cjs`

Suggested thresholds:

- Unknown-rate regression max delta: `0.02`
- Per-route distribution shift max absolute delta: `0.05`

## Step 5 Quality, Safety, Governance

### Spot-check protocol

- Per release, sample 100-200 rows:
  - 30% unknown
  - 30% heuristic
  - 40% taxonomy-map resolved
- Include changed-route rows from previous release.

### Regression suite

- Deterministic unit tests in `__tests__/category-route-resolver.test.js`
- Golden fixture in `tests/fixtures/category-route-golden.json`
- Gate run in CI with `category-route-golden-diff.cjs`.

### Documentation

- Classification baseline: `docs/products/README.md#category-classification-baseline`
- Reviewer and model policy: `docs/products/README.md#category-review-and-model-policy`
- This integration/governance doc.

### Privacy

- Resolver consumes only product catalog fields:
  - tags/hierarchy
  - product name
  - brand
  - ingredients text
- No patient identifiers are used in route classification.


---

<a id="category-route-rollout-runbook"></a>

## Category Route Rollout Runbook

*Former path: `docs/products/CATEGORY_ROUTE_ROLLOUT_RUNBOOK.md`*

## Ownership

- DRI: Middleware Platform Team
- Backup DRI: Product Data Ops
- Review cadence: Weekly (every Monday) map/rule review and unknown-rate trend check.

## Environment Flags

- `CATEGORY_ROUTE_MAP_FILE`  
  Primary map file (relative to `middleware-platform/`), default: `taxonomy/category-route-map.v1.json`
- `CATEGORY_ROUTE_SHADOW_MAP_FILE`  
  Candidate map file for compute-only or canary evaluation.
- `CATEGORY_ROUTE_CANARY_PERCENT`  
  Stable hash canary percentage (`0-100`) using barcode.
- `CATEGORY_ROUTE_MODE`  
  `normal` (default) or `shadow_only`.

## Step 6 Rollout Checklist

### 1) Dev stage

1. Set map candidates in env:
   - `CATEGORY_ROUTE_MAP_FILE=taxonomy/category-route-map.v1.json`
   - optionally `CATEGORY_ROUTE_SHADOW_MAP_FILE=taxonomy/category-route-map.v1.json`
2. Run:
   - `npm run catalog:rollout:check`
   - `npm run test:session-orchestration` (or relevant scan tests)
3. Compare unknown-rate and route distribution output in `tmp/category-route-observability.candidate.json`.

### 2) Staging deploy

1. Deploy with `CATEGORY_ROUTE_SHADOW_MAP_FILE` set and `CATEGORY_ROUTE_CANARY_PERCENT=0`.
2. Verify API payload fields:
   - `category_route_*`
   - `category_route_shadow` present when shadow enabled
3. Run E2E scan suite and API health checks.

### 3) Production rollout (canary)

1. Start at `CATEGORY_ROUTE_CANARY_PERCENT=5`.
2. Monitor unknown-rate and route shifts for 24h.
3. Increase gradually (5% -> 20% -> 50% -> 100%) only if guard thresholds pass.

### 4) Post-deploy (24–48h)

1. Generate post-deploy report:
   - `npm run catalog:observability:report`
2. Compare with baseline:
   - `npm run catalog:regression:guard`
3. Record summary in release notes (unknown delta + top route shifts + top unknown tags).

## Rollback Procedure (tested)

Immediate rollback options:

1. Set `CATEGORY_ROUTE_CANARY_PERCENT=0`.
2. Remove `CATEGORY_ROUTE_SHADOW_MAP_FILE`.
3. Keep `CATEGORY_ROUTE_MAP_FILE` on known-good version.
4. Re-run:
   - `npm run catalog:rollout:check`
5. Confirm route output is stable and golden diff passes.

## Shadow Mode (compute-only)

Set:

- `CATEGORY_ROUTE_MODE=shadow_only`
- `CATEGORY_ROUTE_SHADOW_MAP_FILE=<candidate-map>`

Behavior:

- API returns active category from shadow map.
- Compare `category_route` and `category_route_shadow` fields during validation before enabling canary.


---

<a id="cbd-medical-knowledge-summary"></a>

## CBD Medical Knowledge Summary for Voice Agent

*Former path: `docs/products/cbd-medical-knowledge-summary.md`*

## 🎯 Purpose
Enable the voice agent to provide informed recommendations about CBD products based on customer needs (sleep, pain, activity, anxiety).

---

## 📊 Research Findings

### 1. Product Types & Medical Uses

#### **CBD Oils & Tinctures**
- **Best For**: Sleep, Anxiety, General Pain Relief
- **Onset**: 15-30 minutes (fast)
- **Duration**: 4-6 hours
- **Medical Uses**:
  - Sleep disorders (insomnia)
  - Anxiety and stress
  - Chronic pain management
  - General wellness

#### **Edibles (Gummies, Capsules)**
- **Best For**: Sleep, Sustained Pain Relief, Anxiety
- **Onset**: 30-90 minutes (slow)
- **Duration**: 4-8 hours (long-lasting)
- **Medical Uses**:
  - Sleep support (long-lasting effects)
  - Chronic pain (sustained relief)
  - Anxiety management throughout the day
  - Discreet consumption

#### **Vapes & Pre-Rolls**
- **Best For**: Quick Pain Relief, Acute Anxiety, Activity/Energy
- **Onset**: Minutes (fastest)
- **Duration**: 1-2 hours (short)
- **Medical Uses**:
  - Breakthrough pain
  - Acute anxiety episodes
  - Quick relief needed
  - **Note**: Sativa-dominant strains can be energizing

#### **Topicals (Creams, Balms)**
- **Best For**: Localized Pain, Inflammation, Skin Issues
- **Onset**: 15-30 minutes
- **Duration**: 2-4 hours
- **Medical Uses**:
  - Joint pain (arthritis)
  - Muscle soreness
  - Localized inflammation
  - Skin conditions
  - **Note**: Does NOT enter bloodstream significantly

#### **Capsules**
- **Best For**: Sleep, Consistent Dosing, Daily Wellness
- **Onset**: 30-90 minutes
- **Duration**: 4-6 hours
- **Medical Uses**:
  - Sleep disorders
  - Consistent daily supplementation
  - Precise dosing

---

### 2. Strain Types & Effects

#### **Indica-Dominant**
- **Effects**: Relaxing, sedating, body-focused
- **Best For**: Sleep, Pain Relief, Relaxation
- **Medical Uses**:
  - Insomnia
  - Chronic pain
  - Muscle spasms
  - Anxiety (calming)
- **When to Recommend**: Evening use, sleep issues, body pain

#### **Sativa-Dominant**
- **Effects**: Energizing, uplifting, mind-focused
- **Best For**: Activity, Energy, Focus, Daytime Use
- **Medical Uses**:
  - Depression
  - Fatigue
  - Focus/concentration
  - Mood elevation
- **When to Recommend**: Daytime use, activity, energy needs
- **⚠️ NOT recommended for sleep**

#### **Hybrid**
- **Effects**: Balanced, combination of indica/sativa
- **Best For**: Versatile use
- **Medical Uses**: Depends on ratio (indica/sativa balance)

---

### 3. CBD Spectrum Types

#### **Full-Spectrum CBD**
- Contains CBD + other cannabinoids + trace THC (<0.3%)
- **Best For**: Comprehensive benefits, "entourage effect"
- **Medical Uses**: All conditions (most comprehensive)

#### **Broad-Spectrum CBD**
- Contains CBD + other cannabinoids, NO THC
- **Best For**: Benefits without THC exposure
- **Medical Uses**: All conditions (for THC-sensitive users)

#### **CBD Isolate**
- Pure CBD only
- **Best For**: Drug testing concerns, THC sensitivity
- **Medical Uses**: All conditions (most limited effects)

---

## 🎯 Medical Use Categories

### **SLEEP**
**Best Products**:
- Indica-dominant strains (pre-rolls, flower)
- CBD tinctures/oils (full-spectrum)
- CBD edibles (gummies, capsules) - long-lasting
- CBD capsules

**Why**: 
- Indica provides sedating, relaxing effects
- Edibles provide long-lasting effects (4-8 hours)
- Full-spectrum may enhance sleep quality

**Agent Guidance**:
- "For sleep support, I'd recommend our indica-dominant products or CBD edibles, which provide long-lasting effects throughout the night."
- "CBD tinctures taken before bed can help with sleep onset."

---

### **PAIN RELIEF**
**Best Products**:
- CBD topicals (localized pain)
- CBD tinctures/oils (systemic pain)
- CBD edibles (chronic pain - long-lasting)
- Indica-dominant strains (body pain)

**Why**:
- Topicals target specific areas
- Tinctures provide systemic relief
- Edibles offer sustained relief
- Indica helps with body pain

**Agent Guidance**:
- "For localized pain, our CBD topicals are excellent - they target the specific area without affecting your whole body."
- "For chronic pain, CBD edibles provide sustained relief throughout the day."
- "CBD tinctures offer quick relief for systemic pain."

---

### **ACTIVITY/ENERGY**
**Best Products**:
- Sativa-dominant strains (pre-rolls, flower)
- CBD vapes (quick energy boost)
- Broad-spectrum CBD (no drowsiness)

**Why**:
- Sativa provides energizing effects
- Vapes offer quick onset
- Avoid indica (sedating) for activity

**Agent Guidance**:
- "For daytime use and activity, I'd recommend our sativa-dominant products - they provide energizing, uplifting effects."
- "CBD vapes offer quick energy boosts when you need them."
- "Avoid indica-dominant products for activity - they're more relaxing and better for evening use."

---

### **ANXIETY**
**Best Products**:
- CBD tinctures/oils (quick relief)
- CBD edibles (sustained relief)
- Indica-dominant (calming)
- Full-spectrum or broad-spectrum

**Why**:
- Tinctures provide fast relief
- Edibles offer sustained anxiety management
- Indica has calming properties

**Agent Guidance**:
- "For anxiety, CBD tinctures provide quick relief when you need it."
- "CBD edibles offer sustained anxiety management throughout the day."
- "Indica-dominant products have calming properties that can help with anxiety."

---

## 📋 Agent Response Templates

### When Customer Asks About Sleep:
"I can help you find products for sleep support. Our indica-dominant products and CBD edibles are excellent for sleep - they provide relaxing, long-lasting effects that can help you get a good night's rest. Would you like to hear about our sleep-support products?"

### When Customer Asks About Pain:
"For pain relief, we have several options. If you have localized pain in a specific area, our CBD topicals are great - they target the area directly. For chronic or systemic pain, CBD tinctures or edibles provide longer-lasting relief. What type of pain are you experiencing?"

### When Customer Asks About Activity/Energy:
"For daytime use and activity, I'd recommend our sativa-dominant products - they provide energizing, uplifting effects perfect for staying active. CBD vapes also offer quick energy boosts. These are great for daytime use, but I'd avoid them before bed."

### When Customer Asks About Anxiety:
"For anxiety, CBD tinctures provide quick relief when you need it, while CBD edibles offer sustained anxiety management throughout the day. Our indica-dominant products also have calming properties. Would you like to explore these options?"

---

## ⚠️ Important Disclaimers

**Agent MUST Always Include**:
1. "CBD products are not FDA-approved for medical use"
2. "Individual experiences may vary"
3. "Consult with a healthcare professional before starting any CBD regimen, especially if you have existing health conditions or are taking medications"
4. "Start with a low dose and gradually increase as needed"
5. "Look for third-party tested products to ensure quality"

---

## 🔍 Product Matching Logic

### How to Match Products to Customer Needs:

1. **Extract Customer Need**:
   - "I need help with sleep" → SLEEP category
   - "I have pain" → PAIN category
   - "I want something for daytime" → ACTIVITY category
   - "I'm anxious" → ANXIETY category

2. **Match Product Type**:
   - Check product category (pre-roll, tincture, edible, topical, etc.)
   - Check product name for strain indicators (indica, sativa, hybrid)
   - Check description for medical use keywords

3. **Recommend Based on Match**:
   - Present products that match the need
   - Explain why they're good for that need
   - Mention onset time and duration
   - Include appropriate disclaimers

---

## 📚 Sources
- CBD Source Online: CBD Essentials Guide
- Healthline: CBD Product Reviews
- Medical News Today: CBD Research
- ConsumerLab: CBD Testing & Reviews
- Various medical and wellness sources



---

<a id="cbd-product-analysis"></a>

## CBD Product Analysis & Medical Information Research

*Former path: `docs/products/cbd-product-analysis.md`*

## 📊 Product Database Analysis

### Current Status
- **Total Products**: ~98 products (need to verify exact count)
- **Database Location**: `middleware-platform/middleware-dev.db`
- **Product Fields Available**:
  - `name` / `title`
  - `category`
  - `price`
  - `description`
  - `inventory`
  - `image_url`

### Product Categories (Expected)
Based on typical CBD dispensary inventory:
- Pre-Rolls
- Tinctures/Oils
- Edibles (Gummies, Chocolates)
- Topicals (Creams, Balms)
- Vapes/Cartridges
- Capsules
- Flower
- Concentrates

---

## 🔍 Web Research Findings: CBD Medical Information

### 1. CBD Product Types & Medical Uses

#### **CBD Oils & Tinctures**
- **Best For**: Sleep, Anxiety, General Pain Relief
- **Onset**: 15-30 minutes (fast)
- **Duration**: 4-6 hours
- **Medical Uses**:
  - Sleep disorders (insomnia)
  - Anxiety and stress
  - Chronic pain management
  - General wellness

#### **Edibles (Gummies, Capsules)**
- **Best For**: Sleep, Sustained Pain Relief, Anxiety
- **Onset**: 30-90 minutes (slow)
- **Duration**: 4-8 hours (long-lasting)
- **Medical Uses**:
  - Sleep support (long-lasting effects)
  - Chronic pain (sustained relief)
  - Anxiety management throughout the day
  - Discreet consumption

#### **Vapes & Pre-Rolls**
- **Best For**: Quick Pain Relief, Acute Anxiety, Activity/Energy
- **Onset**: Minutes (fastest)
- **Duration**: 1-2 hours (short)
- **Medical Uses**:
  - Breakthrough pain
  - Acute anxiety episodes
  - Quick relief needed
  - **Note**: Some strains can be energizing (sativa-dominant)

#### **Topicals (Creams, Balms)**
- **Best For**: Localized Pain, Inflammation, Skin Issues
- **Onset**: 15-30 minutes
- **Duration**: 2-4 hours
- **Medical Uses**:
  - Joint pain (arthritis)
  - Muscle soreness
  - Localized inflammation
  - Skin conditions
  - **Note**: Does NOT enter bloodstream significantly

#### **Capsules**
- **Best For**: Sleep, Consistent Dosing, Daily Wellness
- **Onset**: 30-90 minutes
- **Duration**: 4-6 hours
- **Medical Uses**:
  - Sleep disorders
  - Consistent daily supplementation
  - Precise dosing

---

### 2. CBD Spectrum Types & Effects

#### **Full-Spectrum CBD**
- Contains CBD + other cannabinoids + trace THC (<0.3%)
- **Best For**: Comprehensive benefits, "entourage effect"
- **Medical Uses**: All conditions (most comprehensive)

#### **Broad-Spectrum CBD**
- Contains CBD + other cannabinoids, NO THC
- **Best For**: Benefits without THC exposure
- **Medical Uses**: All conditions (for THC-sensitive users)

#### **CBD Isolate**
- Pure CBD only
- **Best For**: Drug testing concerns, THC sensitivity
- **Medical Uses**: All conditions (most limited effects)

---

### 3. Strain Types & Effects (For Flower/Pre-Rolls)

#### **Indica-Dominant**
- **Effects**: Relaxing, sedating, body-focused
- **Best For**: Sleep, Pain Relief, Relaxation
- **Medical Uses**:
  - Insomnia
  - Chronic pain
  - Muscle spasms
  - Anxiety (calming)

#### **Sativa-Dominant**
- **Effects**: Energizing, uplifting, mind-focused
- **Best For**: Activity, Energy, Focus, Daytime Use
- **Medical Uses**:
  - Depression
  - Fatigue
  - Focus/concentration
  - Mood elevation
  - **Note**: NOT recommended for sleep

#### **Hybrid**
- **Effects**: Balanced, combination of indica/sativa
- **Best For**: Versatile use
- **Medical Uses**: Depends on ratio (indica/sativa balance)

---

## 📋 Medical Use Categories

### **SLEEP**
**Best Products**:
- Indica-dominant strains (pre-rolls, flower)
- CBD tinctures/oils (full-spectrum)
- CBD edibles (gummies, capsules) - long-lasting
- CBD capsules

**Why**: 
- Indica provides sedating, relaxing effects
- Edibles provide long-lasting effects (4-8 hours)
- Full-spectrum may enhance sleep quality

### **PAIN RELIEF**
**Best Products**:
- CBD topicals (localized pain)
- CBD tinctures/oils (systemic pain)
- CBD edibles (chronic pain - long-lasting)
- Indica-dominant strains (body pain)

**Why**:
- Topicals target specific areas
- Tinctures provide systemic relief
- Edibles offer sustained relief
- Indica helps with body pain

### **ACTIVITY/ENERGY**
**Best Products**:
- Sativa-dominant strains (pre-rolls, flower)
- CBD vapes (quick energy boost)
- Broad-spectrum CBD (no drowsiness)

**Why**:
- Sativa provides energizing effects
- Vapes offer quick onset
- Avoid indica (sedating) for activity

### **ANXIETY**
**Best Products**:
- CBD tinctures/oils (quick relief)
- CBD edibles (sustained relief)
- Indica-dominant (calming)
- Full-spectrum or broad-spectrum

**Why**:
- Tinctures provide fast relief
- Edibles offer sustained anxiety management
- Indica has calming properties

---

## 🎯 Recommendations for Agent Knowledge Base

### Information to Add to Products:

1. **Medical Use Tags**:
   - `best_for_sleep`: true/false
   - `best_for_pain`: true/false
   - `best_for_activity`: true/false
   - `best_for_anxiety`: true/false

2. **Product Type Classification**:
   - `product_type`: "tincture" | "edible" | "topical" | "vape" | "pre-roll" | "capsule"
   - `strain_type`: "indica" | "sativa" | "hybrid" | null
   - `cbd_spectrum`: "full-spectrum" | "broad-spectrum" | "isolate" | null

3. **Effect Information**:
   - `onset_time`: "fast" (minutes) | "medium" (15-30 min) | "slow" (30-90 min)
   - `duration`: "short" (1-2 hours) | "medium" (4-6 hours) | "long" (6+ hours)
   - `effects`: ["relaxing", "energizing", "pain-relief", "sleep-support"]

4. **Medical Guidance**:
   - `medical_uses`: Array of use cases
   - `recommended_for`: Array of conditions
   - `contraindications`: Array of warnings

---

## 🔍 Next Steps

1. **Extract Product Data**: Need to query database to get actual product list
2. **Match Products to Categories**: Map existing products to medical use categories
3. **Enrich Product Data**: Add medical information fields to products
4. **Update Agent Prompt**: Include medical guidance in agent instructions
5. **Create Product Knowledge Base**: Structured data for agent to reference

---

## ⚠️ Important Notes

1. **Medical Disclaimer**: Agent should always include disclaimer that CBD is not FDA-approved for medical use
2. **Consultation Recommendation**: Agent should recommend consulting healthcare provider
3. **Individual Variation**: Effects vary by person
4. **Dosage Guidance**: Start low, increase gradually
5. **Quality Matters**: Recommend third-party tested products

---

## 📚 Sources

- CBD Source Online: CBD Essentials Guide
- Healthline: CBD Product Reviews
- Medical News Today: CBD Research
- ConsumerLab: CBD Testing & Reviews
- Various medical and wellness sources



---

<a id="open-beauty-facts-data-model"></a>

## Open Beauty Facts (global) — API data model & categorization

*Former path: `docs/products/OPEN_BEAUTY_FACTS_DATA_MODEL.md`*

**Scope:** How [Open Beauty Facts](https://world.openbeautyfacts.org/) (OBF) stores and exposes product data in the **same Product Opener JSON** shape as [Open Food Facts](https://world.openfoodfacts.org/) (OFF). OBF is the cosmetics / personal-care instance; field names and taxonomy rules are shared.

**Last updated:** April 9, 2026

---

## 1. Endpoint your stack uses

**Upstream (Product Opener, not Somo):** the public read contract is documented in the [Open Food Facts Server API](https://openfoodfacts.github.io/openfoodfacts-server/api/) (OBF uses the same shape on `world.openbeautyfacts.org`).

| Layer | URL / role |
|--------|-----|
| **Official read API** | `GET {host}/api/v2/product/{barcode}` with `Accept: application/json` |
| **OBF host (default)** | `https://world.openbeautyfacts.org` (override with `OPEN_BEAUTY_FACTS_BASE_URL`) |

**Somo integration (internal only — not part of the upstream API):**

| Piece | Role |
|--------|------|
| **`open-beauty-facts-service.js`** | In-process HTTP **client** to OBF: same path as above, `GET` + `Accept: application/json`. |
| **`GET /api/public/beautyfacts/:barcode`** | Middleware **route** that calls `fetchBeautyFactsByBarcode` and returns the normalized product JSON to your apps. |

Response shape (simplified):

```json
{
  "code": "3574669909594",
  "status": 1,
  "status_verbose": "product found",
  "product": { "...": "see below" }
}
```

- **`status`**: `1` = found, `0` = not found (barcode known to API but no product, or invalid).
- **`product`**: Full document; size varies (often tens of KB with images metadata).

---

## 2. How products are *categorised* in the API (taxonomy mapping)

OBF does **not** use a single numeric “category id” only. Classification is done with **parallel representations** of the same information:

| Field | Role |
|--------|------|
| **`categories`** | Human-editable string (often comma-separated), as entered on the website / app. **Not** stable for code or analytics. |
| **`categories_tags`** | **Normalized** tags: identifiers such as `en:shower-gels`, `en:body-creams`. This is the **machine** list used for search and facets. **Use `categories_tags` for logic, filters, and analytics**; do not rely on raw `categories` for those. |
| **`categories_hierarchy`** | Same tags ordered **from broad → specific** (parent chain). Useful for trees / “where in the taxonomy” logic. |
| **`categories_lc`** | **Language code** for category display (e.g. `fr`), not a duplicate of hierarchy. |
| **`categories_fr`** / **`main_category_fr`** (etc.) | Locale-specific **display** fields when present (pattern repeats per locale). |
| **`compared_to_category`** | Internal comparison bucket; on beauty products you may see values such as `en:open-beauty-facts` (non-food / beauty context). |
| **`main_category`** / **`main_category_en`** (when present) | A single primary category (export / simplified views; not always present in every JSON). |

**`_tags` fields in JSON:** In API **JSON** responses, fields like `categories_tags`, `states_tags`, etc. are typically **arrays of strings**. Comma-separated lists appear in other contexts (e.g. some **CSV** exports or **request** parameters using `fields=…` — note the plural **`fields`**, not `field`). See [data-fields.txt](https://static.openfoodfacts.org/data/data-fields.txt) and the [full JSON example](https://wiki.openfoodfacts.org/API/Full_JSON_example) on the OFF wiki.

**Ingredients / labels / allergens** use the same pattern:

| Cluster | Free-ish input | Normalized tags | Hierarchy |
|---------|------------------|-----------------|-----------|
| Ingredients | `ingredients_text`, parsed structure | `ingredients_tags` | `ingredients_hierarchy` |
| Labels (certifications) | `labels` | `labels_tags` | `labels_hierarchy` |
| Allergens | `allergens` | `allergens_tags` | `allergens_hierarchy` |
| Countries | `countries` | `countries_tags` | `countries_hierarchy` |

So the **mapping** you care about for “how is it categorised” is:

```text
categories (text)  →  parser / taxonomy  →  categories_tags  +  categories_hierarchy
```

The **canonical ids** for automation are the **`categories_tags`** (and hierarchy order), not the raw `categories` string.

---

## 3. Product type (and food vs non-food context)

The **`product_type`** field **may** appear on some Product Opener documents. Official API documentation does **not** define a fixed, stable enum for cosmetics (or guarantee a particular string). Treat any value as **opaque**: verify behavior against **live payloads in your own environment** if you depend on it.

Somo **passes through** **`product_type`** as a string when present, without interpreting it as a known enum.

Nutrition-related fields (e.g. `nutriments`, Nutri-Score) are often **empty** or **not applicable** for cosmetics; the API may still include `nutriscore_grade: "not-applicable"` etc.

---

## 4. Other high-signal fields (storage model)

From the shared [data-fields](https://static.openfoodfacts.org/data/data-fields.txt) conventions and live OBF JSON:

| Area | Fields |
|------|--------|
| Identity | `code`, `url`, `product_name`, `product_name_en`, `brands`, `brands_tags`, `quantity` |
| Media | `image_url`, `image_front_url`, `images` (revisioned) |
| Geography | `countries`, `countries_tags`, `origins`, `origins_tags`, `manufacturing_places`, `stores` |
| Composition | `ingredients_text`, `ingredients` (array with `id`, `text`, `percent_*`), `ingredients_analysis_tags` |
| Completion | `states`, `states_tags`, `states_hierarchy` (e.g. photos completed, categories to be completed) |
| Meta | `created_t`, `last_modified_t`, `creator`, `editors_tags` |

**Timestamps:** Fields ending in `_t` are **Unix seconds**; `_datetime` fields are ISO 8601 when present (per data-fields.txt).

---

## 5. How Somo maps this (normalized subset)

`middleware-platform/services/open-beauty-facts-service.js` builds a **normalized object** for `GET /api/public/beautyfacts/:barcode` and internal callers:

| OBF / `product` source | Somo `normalized` field |
|-------------------------|------------------------------|
| `code` / `product.code` | `barcode` |
| `status` | `found` (boolean: status === 1) |
| `product_name`, `product_name_en`, `product_name_fr` | `product_name` (first match) |
| `brands` | `brands` (split list) |
| `ingredients_text_with_allergens` → `ingredients_text_en` → `ingredients_text` | `ingredients_text` |
| `product.ingredients[]` | `ingredients`: `{ id?, text, percent_estimate? }[]` (capped at 80 rows); canonical **`id`** preserved when present |
| `allergens` | `allergens` (split list) |
| `labels` | `labels` (split list) |
| **`categories`** | **`categories`** (split list) — **display / human string**; same source OBF stores |
| **`categories_tags`** | `string[]` — **Use `categories_tags` for logic, filters, and analytics** |
| **`categories_hierarchy`** | **`categories_hierarchy`** (`string[]`) |
| **`ingredients_analysis_tags`** | **`ingredients_analysis_tags`** (`string[]`) |
| **`states_tags`** | **`states_tags`** (`string[]`) — completeness / quality hints |
| **`product_type`** | **`product_type`** (`string \| null`) — opaque pass-through if upstream sends it; not a documented fixed enum |
| `image_front_url` / `image_url` | `image_url` |
| `url` | `product_url` |

**Internal grading (not OBF):** `middleware-platform/services/product-grade-resolver.js` combines **labels**, **categories** (display), **`categories_tags`**, **`ingredients_analysis_tags`**, **`states_tags`**, **ingredient lines**, and **name** text into a **`grade_class`** (`MEDICAL_RX`, `OTC_DRUG`, `PROFESSIONAL`, `COSMECEUTICAL_MARKETING`, `GENERAL_COSMETIC`). That is **Somo logic**, not an OBF field.

**Caching / load:** The client does not cache responses today. For production, **cache by barcode** (e.g. TTL 24h+) and deduplicate concurrent lookups to protect upstream and latency.

---

## 6. Where to read more (official)

- **Field list (CSV export; same field names as JSON):** [data-fields.txt](https://static.openfoodfacts.org/data/data-fields.txt)
- **Product Opener / server API docs:** [Open Food Facts Server API](https://openfoodfacts.github.io/openfoodfacts-server/api/) (OBF uses the same read API on a different host)
- **OBF web:** [world.openbeautyfacts.org](https://world.openbeautyfacts.org/)

---

## 7. Summary

1. **Categorisation** in OBF is stored as **raw `categories` text** plus **normalized `categories_tags`** and **`categories_hierarchy`**. **Use `categories_tags` for logic, filters, and analytics**; keep **`categories`** for display.
2. The **remote** OBF index is a **large, growing** crowdsourced dataset; your SQLite mirror only stores products you have looked up or imported.
3. **Somo** exposes taxonomy tags, analysis tags, state tags, and structured ingredients on the normalized product from the internal beautyfacts route; **`product_type`** is included only as an **opaque** pass-through when the upstream payload provides it.


---

<a id="product-list"></a>

## Product Inventory List

*Former path: `docs/products/PRODUCT_LIST.md`*

## Products from VIBESAK/VIBES AK

### EXOTICS - Premium Tier

| Product Name | Description | THC % | Size Options | Prices |
|-------------|-------------|-------|--------------|--------|
| MONA LISA | 60% Indica / 40% Sativa | 28% | 1/8, 1/4, 1/2, OZ | $45, $80, $140, $240 |
| ZLUSHIES | 40% Sativa / 60% Indica | 25% | 1/8, 1/4, 1/2, OZ | $45, $80, $140, $240 |
| CHERRY ZLUSHIES | 60% Indica / 40% Sativa | 30% | 1/8, 1/4, 1/2, OZ | $45, $90, $165, $350 |
| PINK PICASSO | 50% Indica / 50% Sativa | 30% | 1/8, 1/4, 1/2, OZ | $45, $90, $165, $350 |
| ZAFFYS | Premium exotic strain | - | 1/8, 1/4, 1/2, OZ | $45, $90, $165, $350 |
| JUICY DROP'Z | Indica Dominant | 31% | 1/8, 1/4, 1/2, OZ | $45, $90, $165, $350 |
| BROOKLYN GUMBO | 65% Indica / 35% Sativa | 28% | 1/8, 1/4, 1/2, OZ | $45, $90, $165, $350 |
| PURPLE URKLE | 70% Indica / 30% Sativa | 26% | 1/8, 1/4, 1/2, OZ | $45, $90, $165, $350 |

### MIDS - Standard Tier

| Product Name | Description | THC % | Size Options | Prices |
|-------------|-------------|-------|--------------|--------|
| GMO | 90% Sativa / 10% Indica | 24% | 1/8, 1/4, 1/2, OZ | $30, $55, $105, $130 |
| CHERRY PIE | 80% Indica / 20% Sativa | 24% | 1/8, 1/4, 1/2, OZ | $30, $55, $105, $130 |
| GARY PAYTON | 50% Sativa / 50% Indica | 25% | 1/8, 1/4, 1/2, OZ | $30, $55, $110, $150 |
| BLACK DIAMOND | 70% Indica / 30% Sativa | 24% | 1/8, 1/4, 1/2, OZ | $30, $55, $105, $180 |
| PURPLE PESO | Indica Dominant | 22% | 1/8, 1/4, 1/2, OZ | $30, $55, $105, $180 |
| OREO | 70% Indica / 30% Sativa | 22% | 1/8, 1/4, 1/2, OZ | $30, $55, $105, $180 |
| KANDY KRUSH | 75% Indica / 25% Sativa | 23% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| BLUE RUNTZ | 65% Indica / 35% Sativa | 26% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| GMO KUSH | 60% Indica / 40% Sativa | 25% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| ROCK CANDY | 80% Indica / 20% Sativa | 22% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| COOKIES | 60% Indica / 40% Sativa | 24% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| LEMON CHERRY | 50% Indica / 50% Sativa | 25% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| LAFFY TAFFY | 60% Sativa / 40% Indica | 24% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| BLUE NERDS | 50% Sativa / 50% Indica | 22% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |
| UNICORN PISS | 50% Indica / 50% Sativa | 24% | 1/8, 1/4, 1/2, OZ | $35, $65, $110, $180 |

### SPECIALTY ITEMS

| Product Name | Description | Size | Price |
|-------------|-------------|------|-------|
| GOLDEN TEACHER MUSHROOMS | Psilocybe Cubensis species. Contains psilocybin and psilocin. Provides unique healing qualities and euphoric experience. | 1g | $50 |
| MYSTERY BAGS | 3.5g mystery selection | 3.5g | $25 |
| SHAKE BAGS | 3.5g shake | 3.5g | $20 |
| MOON ROCK | Premium moon rock | 1g | $40 |
| EDIBLES | Assorted edibles | Each | $40 |
| PRE-ROLLS | Any strain pre-rolled | Each | $20 |

## Total Products

- **Exotics**: 8 products × 4 sizes = 32 SKUs
- **Mids**: 15 products × 4 sizes = 60 SKUs  
- **Specialty**: 6 products = 6 SKUs
- **Total**: 98 product SKUs

## Notes

- Each product with multiple sizes will be created as separate SKUs (e.g., "MONA LISA - 1/8", "MONA LISA - 1/4", etc.)
- Default starting inventory: 100 units per SKU
- Products are organized by category for easy management
- All products will be linked to the merchant's subdomain




---

<a id="readme"></a>

## Products Documentation

*Former path: `docs/products/README.md`*

Reference documentation for product-related features.

## Contents

- **[OPEN_BEAUTY_FACTS_DATA_MODEL.md](./README.md#open-beauty-facts-data-model)** — OBF global API: categories/tags/hierarchy, field mapping, and how Somo normalizes responses
- **cbd-medical-knowledge-summary.md** — CBD product types and medical uses for voice agent recommendations (sleep, pain, anxiety)
- **cbd-product-analysis.md** — Product analysis
- **PRODUCT_LIST.md** — Example product inventory (tenant-specific reference)

**Note:** PRODUCT_LIST and related files may be tenant-specific.

**Barcode / product lookup (current code):**

- `GET /api/public/beautyfacts/:barcode` (OBF) and `GET /api/public/foodfacts/:barcode` (OFF)
- master-first serving from local catalog indexes (`products_obf_index`, `products_off_index`)
- live upstream calls are fallback only, with successful fallback results upserted into master indexes

Canonical admin stats/KPI:

- `GET /api/admin/catalog/master-stats`
- `GET /api/admin/metrics` → `catalog_master`

---

**Last Updated:** April 14, 2026


