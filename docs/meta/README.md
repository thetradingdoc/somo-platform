# meta — consolidated documentation

> **Read first:** [CANONICAL_DOC_MAP.md](./CANONICAL_DOC_MAP.md) (topic index). Hygiene rules: [§ Engineering doc hygiene](#engineering-doc-hygiene).

**Single file:** All former `docs/meta/**/*.md` content is merged here. **Last updated:** 2026-04-29

## Table of contents

- [Canonical documentation map (reduce duplicate reading) (`CANONICAL_DOC_MAP.md`)](#canonical-doc-map)
- [Codebase batch review and documentation gaps (`CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md`)](#codebase-batch-review-and-documentation-gaps)
- [Documentation Cleanup – March 2026 (`DOC_CLEANUP_MARCH_2026.md`)](#doc-cleanup-march-2026)
- [Documentation Audit & Consolidation Plan (`DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md`)](#documentation-audit-and-consolidation-plan)
- [Gap Analysis: Richer Triage & Patient Records Q&A (`GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md`)](#gap-analysis-richer-triage-and-records)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

<a id="engineering-doc-hygiene"></a>

## Engineering doc hygiene (2026-06-02)

- **Two files per folder:** `README.md` + one companion (`OPERATIONS.md`, `LIVE.md`, `RUNBOOK.md`, etc.). Exceptions: runtime prompt paths under `voice-agent/prompts/`.
- **Read first:** [CANONICAL_DOC_MAP.md](./CANONICAL_DOC_MAP.md) — not the 12k-line `architecture/README.md` or `deployment/README.md` archives.
- **New ops content:** append to the folder’s companion file with a dated anchor; register retired paths in [`_consolidated_path_redirects.json`](../_consolidated_path_redirects.json).
- **Regenerate merges:** `node scripts/consolidate-docs-two-per-folder.cjs`

<a id="staging-profile"></a>

## Staging profile

*Former path: `docs/STAGING_PROFILE.md`.*

| Role | URL |
|------|-----|
| UI | `https://callsomo.com` (staging) |
| API | `https://api.callsomo.com` |

**Preflight:** `npm run staging:preflight`, `npm run billing:test-gate`, `npm run audit:trial-provision-drift` (from `middleware-platform/`).

**DB truth:** GCS `middleware-staging.db` may lag Postgres — see [`Database/OPERATIONS.md`](../Database/OPERATIONS.md#somo-foundation-runbook). See also [`testing/README.md`](../testing/README.md).

<a id="surface-ownership-map"></a>

## Surface ownership map

| Surface | Code | Docs |
|---------|------|------|
| Marketing landing | `unified-dashboard/somo-landing/` | [`deployment/OPERATIONS.md`](../deployment/OPERATIONS.md#somo-landing), [`design/SOMO_MARKETING_COLORS.md`](../design/SOMO_MARKETING_COLORS.md) |
| Middleware API | `middleware-platform/` | [`middleware-platform/README.md`](../middleware-platform/README.md), [`architecture/LIVE.md`](../architecture/LIVE.md) |
| Patient mobile | `patient-app/` (repo root) | `patient-app/README.md` if present |

<a id="po-surface-scorecard"></a>

## PO surface scorecard

RAG status per surface — see [`todos/PENDING.md`](../../todos/PENDING.md) for open ops gaps. Staging matrix: `npm run staging:preflight` from `middleware-platform/`.

---

<a id="codebase-batch-review-and-documentation-gaps"></a>

## Codebase batch review and documentation gaps

Tracked output from a batched line-level review request (codebase -> routes -> services):

- [`meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md`](./CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md)

Use this as the active checklist for documentation parity with implementation.

---

<a id="canonical-doc-map"></a>

## Canonical documentation map (reduce duplicate reading)

*Former path: `docs/meta/CANONICAL_DOC_MAP.md`*

Use this when two folders both mention Kelly, checkout, or triage. **Start with the primary doc**; secondaries add depth or a different audience.

**Middleware (Kelly, checkout, Retell, LangGraph, security checklists, etc.):** one file — [`middleware-platform/README.md`](./middleware-platform/README.md#readme) — use the [table of contents](./middleware-platform/README.md#table-of-contents) for section anchors (e.g. `#kelly-phase-prompt-architecture`, `#architecture-kelly-payment`, `#voice-triage-parity`).

| Topic | Read first | Also useful (do not duplicate maintenance) |
|-------|------------|-----------------------------------------------|
| **Kelly phase prompts, Skin & Care intake, orchestrator** | [`README.md#kelly-phase-prompt-architecture`](./middleware-platform/README.md#kelly-phase-prompt-architecture) + [`#kelly-god-object-fix-todos`](./middleware-platform/README.md#kelly-god-object-fix-todos) | [`#retell-kelly-flow`](./middleware-platform/README.md#retell-kelly-flow); voice prompt text in [`voice-agent/prompts/`](./voice-agent/prompts/) |
| **Kelly + payment / checkout (middleware behavior)** | [`README.md#architecture-kelly-payment`](./middleware-platform/README.md#architecture-kelly-payment) | [`architecture/commerce/PUBLIC_AGENTIC_CHECKOUT.md`](./architecture/README.md#commerce-public-agentic-checkout) (product/surface); [`AGENTIC_CHECKOUT_FILE_MAP.md`](./architecture/README.md#commerce-agentic-checkout-file-map) (file index) |
| **Checkout runbooks & incidents** | [`#runbook-payment-settlement`](./middleware-platform/README.md#runbook-payment-settlement), [`#checkout-state-contamination-runbook`](./middleware-platform/README.md#checkout-state-contamination-runbook) | [`#payment-data-incident-playbook`](./middleware-platform/README.md#payment-data-incident-playbook); [`#stripe-webhook-paths`](./middleware-platform/README.md#stripe-webhook-paths) |
| **Voice agent architecture (Retell, tools, coding)** | [`architecture/voice-agent/RUNBOOK.md`](./architecture/README.md#voice-agent-runbook) + [`VOICE_AGENT_TODO_AND_STATUS.md`](./architecture/README.md#voice-agent-voice-agent-todo-and-status) | [`README.md#voice-triage-parity`](./middleware-platform/README.md#voice-triage-parity); [`#retell-config-quick-reference`](./middleware-platform/README.md#retell-config-quick-reference) |
| **Landing Try now + LiveKit (public demo, not provider consult)** | [`architecture/experience/LANDING_TRY_NOW_LIVEKIT.md`](./architecture/README.md#experience-landing-try-now-livekit) | [`architecture/care-delivery/VIDEO_CONSULT.md`](./architecture/README.md#care-delivery-video-consult) (provider rooms + agents); [`README.md#kelly-phase-prompt-architecture`](./middleware-platform/README.md#kelly-phase-prompt-architecture) (Kelly HTTP) |
| **UV imaging track (future, separate from RGB CV)** | [`architecture/vision/VISION_UV_R_AND_D.md`](./architecture/README.md#vision-vision-uv-r-and-d) | [`architecture/care-delivery/VIDEO_CONSULT.md`](./architecture/README.md#care-delivery-video-consult) (current production vision boundaries) |
| **Repo / service layout** | [`README.md#architecture`](./middleware-platform/README.md#architecture) | [`architecture/overview/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`](./architecture/README.md#overview-architecture-overview-and-colab-rag) (broader RAG/product) |
| **Derm patient Q&A (RAG pipeline)** | [`architecture/derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md`](./architecture/README.md#derm-patient-qa-phase-0-scope-and-metrics) (then phases 2–5 in same folder) | [`development/KELLY_ENV_AND_DEBUG.md`](./development/README.md#kelly-env-and-debug) for env debugging |
| **Richer triage schema / records (gap analysis)** | [`meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md`](./meta/README.md#gap-analysis-richer-triage-and-records) | Patient journey gaps (if present): `PATIENT_BOOKING_AND_TRIAGE_GAPS.md` under architecture when maintained |
| **Doc hygiene / what was merged when** | [`meta/DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md`](./meta/README.md#documentation-audit-and-consolidation-plan) (historical consolidation plan) | [`meta/DOC_CLEANUP_MARCH_2026.md`](./meta/README.md#doc-cleanup-march-2026) (changelog-style summary only) |

## Meta docs (not product runbooks)

| File | Purpose |
|------|---------|
| [`meta/DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md`](./meta/README.md#documentation-audit-and-consolidation-plan) | Past audit: overlaps identified, many marked **DONE** — keep for history; do not re-merge without a new ticket. |
| [`meta/DOC_CLEANUP_MARCH_2026.md`](./meta/README.md#doc-cleanup-march-2026) | Short log of link fixes and archive moves (March 2026). |

## When to delete vs keep

- **Keep** audit/cleanup docs as **history** unless a maintainer explicitly replaces them with a single “docs index” revision.
- **Delete** only when the same content lives verbatim elsewhere (rare); prefer **archive** under `docs/archive/` per `meta/DOC_CLEANUP_MARCH_2026.md`.

**Last updated:** 2026-04-20


---

<a id="doc-cleanup-march-2026"></a>

## Documentation Cleanup – March 2026

*Former path: `docs/meta/DOC_CLEANUP_MARCH_2026.md`*

Summary of doc consolidation, link fixes, and todo organization.

---

## Link fixes

| Broken link | Fixed to |
|-------------|----------|
| `SUBDOMAIN_SSL_FIX.md` | `TENANT_AND_DNS_SETUP.md` |
| `STRIPE_ISSUING_STATUS.md` | `STRIPE_ISSUING.md` |
| `TECH_LEAD_CLEANUP` (development/) | `archive/TECH_LEAD_CLEANUP.md` |
| `FIXES_APPLIED` (maintenance/) | `archive/FIXES_APPLIED.md` |
| `ADMIN_PORTAL_FIXES_COMPLETE` | `archive/ADMIN_PORTAL_FIXES_COMPLETE.md` |

**Files updated:** `pending/PRODUCTION_READINESS_TASKS.md`, `DEPLOYMENT_GUIDE.md`, `AUTOMATED_TENANT_DOMAIN_SETUP.md`, `docs/README.md`, `architecture/README.md`, `admin-portal/*.md`, `todos/README.md`.

---

## Archived docs

Moved to `docs/archive/`:

- **ADMIN_PORTAL_FIXES_COMPLETE.md** — Admin portal fixes (Dec 2025)
- **FIXES_APPLIED.md** — Architecture Phase 1–2 fixes (Jan 2025)
- **TECH_LEAD_CLEANUP.md** — Video Consult + LangSmith consolidation (Feb 2026)

---

## Todo layout

| Location | Contents |
|----------|----------|
| **todos/** | Open work SSOT: [`PENDING.md`](../../todos/PENDING.md); detail: [`CUSTOMER_READY_BACKLOG.md`](../CUSTOMER_READY_BACKLOG.md) |
| **docs/development/** | `MASTER_TODO_FULL.md` (platform roadmap) |
| **docs/architecture/** | Domain-specific TODOs: `VOICE_AGENT_TODO_AND_STATUS`, `TIBA_AND_BILLING_TODO`, `PATIENT_PORTAL_AND_TELEHEALTH_TODO` |
| **docs/** | Gap/analysis: `GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS`, `PATIENT_BOOKING_AND_TRIAGE_GAPS` |

**todos/README.md** lists all task docs and links to related docs for context.

---

## Folder structure (high level)

- **todos/** — Actionable checklists and task lists
- **docs/** — Architecture, how-tos, references; domain TODOs live in their domain folders
- **docs/archive/** — Historical fix summaries and old debug scripts


---

<a id="documentation-audit-and-consolidation-plan"></a>

## Documentation Audit & Consolidation Plan

*Former path: `docs/meta/DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md`*

**Last Updated:** 2026-05-30

**See also:** [meta/CANONICAL_DOC_MAP.md](./meta/README.md#canonical-doc-map) — **where to read first** when Kelly, checkout, and voice docs overlap (living index; update when you add a new “source of truth” doc).

**Status:** Phases 1–5 **APPLIED** (verified April 6, 2026).
- Phase 1–2: Patient/triage merged; placeholder folders removed.
- Phase 3: Financial (Tiba + billing) → TIBA_AND_BILLING_TODO.md; Stripe Issuing → STRIPE_ISSUING.md.
- Phase 4: Voice agent TODOs → VOICE_AGENT_TODO_AND_STATUS.md; Patient architecture → PATIENT_ARCHITECTURE.md, PATIENT_PORTAL_AND_TELEHEALTH_TODO.md, LOCAL_TEST_RUNBOOK.md.
- Phase 5: IONOS → IONOS_DNS_SETUP.md; Tenant/DNS → TENANT_AND_DNS_SETUP.md; final-deployment-checklist removed.

---

## 1. Total Count

| Metric | Count |
|--------|-------|
| **Total .md files in `docs/`** | **~130** (was 167; Phases 1–5 applied) |
| **Estimated total words** | ~150,000+ |
| **Subfolders with docs** | 25 |

---

## 2. Docs by Area

| Area | Count | Notes |
|------|-------|-------|
| **architecture/** | 54 | Largest—many overlapping subsections |
| **deployment/** | 23 | Guides, DNS, Azure, security, DB |
| **development/** | 10 | TODOs, guides, code reviews |
| **runbooks/** | 9 | Incident runbooks |
| **compliance/** | 8 | HIPAA, BAA, PHI, retention |
| **middleware-platform/** | **1** (`README.md`, consolidated) | Kelly, checkout runbooks, Retell, LangGraph, security — all sections in [`middleware-platform/README.md`](./middleware-platform/README.md#readme) |
| **integrations/** | 7 | Stedi, Stripe, UHC |
| **voice-agent/** | 6 | Kelly prompts, README |
| **setup/** | 6 | Stripe, Google, getting-started |
| **products/** | 4 | CBD-related (possibly niche) |
| **admin-portal/** | 4 | Structure, testing, fixes |
| **api/** | 3 | API doc, Invoice API |
| **testing/** | 3 | E2E, telemedicine |
| **email/** | 3 | Setup, issues |
| **onboarding/** | 2 | Clinic checklist |
| **configuration/** | 2 | Calendar, visit charge |
| **azure/** | 2 | Automation, README |
| **Root-level** | 6 | README + 5 gap/todo docs |
| **Single-doc folders** | 7 | user-guides, reports, legal, knowledge-base, geolocation, archive, analysis |

---

## 3. Major Overlaps & Redundancy

### 3.1 Patient / Triage / Matching / Specialist (ROOT — 5 docs → 2) ✅ DONE

| Doc | Purpose | Overlap |
|-----|---------|---------|
| `PATIENT_BOOKING_AND_JOURNEY.md` | Flow, issues, gaps (M1–M5, S1–S4, C1–C4, U1–U4) | Core patient flow |
| `TRIAGE_AND_MATCHING_GAPS.md` | T1–T6, M1–M5, gap1–gap18 | Same matching gaps; different numbering |
| `SPECIALIST_MATCHING_IMPROVEMENT_PLAN.md` | Specialist-centric architecture, matching pipeline | Overlaps TRIAGE + CLINICAL_MARKETPLACE |
| `CLINICAL_MARKETPLACE_TODOS.md` | Golden path, gaps, todos | Overlaps SPECIALIST + PATIENT_BOOKING |
| `meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md` | Richer triage schema, records Q&A | Richer triage only; distinct |

**Consolidation:** Merge into **2 docs**:
1. **`PATIENT_BOOKING_AND_TRIAGE_GAPS.md`** — Flow diagram, current implementation, all gaps (M/S/C/U/T) in one table, fix priorities.
2. **`meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md`** — Keep as-is (distinct scope: schema, records Q&A).

Delete: `TRIAGE_AND_MATCHING_GAPS.md`, `SPECIALIST_MATCHING_IMPROVEMENT_PLAN.md`, `CLINICAL_MARKETPLACE_TODOS.md` (content merged into #1).

---

### 3.2 Financial (5 docs → 2)

| Doc | Purpose |
|-----|---------|
| `FINANCIAL_LAYER_ARCHITECTURE.md` | Main architecture |
| `TIBA_FINANCIAL_LAYER_TODO.md` | Tiba implementation checklist (2,217 words) |
| `TIBA_FINANCIAL_LAYER_GAP_ANALYSIS.md` | Tiba spec → gaps |
| `TIBA_FINANCIAL_LAYER_GAP_REMEDIATION_TODO.md` | Gap remediation code changes |
| `BACKEND_BILLING_REVIEW.md` | Billing/claims API review |

**Consolidation:**
1. **`FINANCIAL_LAYER_ARCHITECTURE.md`** — Keep; add 1–2 paragraph "Tiba alignment" section.
2. **`TIBA_AND_BILLING_TODO.md`** — Merge: GAP_ANALYSIS + GAP_REMEDIATION + TODO + BACKEND_BILLING_REVIEW into one prioritized list.

Delete: 3 Tiba docs, BACKEND_BILLING_REVIEW (content merged).

---

### 3.3 Stripe Issuing (5 docs → 1)

| Doc | Purpose |
|-----|---------|
| `setup/stripe/STRIPE_ISSUING_COMPLETE_GUIDE.md` | Main setup guide (1,915 words) |
| `integrations/stripe/issuing/STRIPE_ISSUING_STATUS.md` | Status & flow |
| `integrations/stripe/issuing/STRIPE_ISSUING_ON_DEMAND.md` | On-demand card creation |
| `architecture/payments/STRIPE_ISSUING_IMPLEMENTATION.md` | Implementation details |
| `architecture/payments/STRIPE_ISSUING_INTEGRATION.md` | How it works |

**Consolidation:** Single **`integrations/stripe/issuing/STRIPE_ISSUING.md`** — Setup + status + on-demand + implementation. Delete the other 4.

---

### 3.4 Voice Agent / Medical Coding (10+ docs)

| Doc | Purpose |
|-----|---------|
| `architecture/voice-agent/MEDICAL_CODING_AGENT_TODO.md` | Implementation roadmap |
| `architecture/voice-agent/AI_AGENT_FINANCIAL_LAYER_TODO.md` | Financial layer integration |
| `architecture/voice-agent/MEDICAL_CODING_AGENT_PROMPT.md` | Retell prompt guidance |
| `architecture/voice-agent/IMPLEMENTATION_STATUS.md` | Status |
| `voice-agent/medical-voice-agent-prompt.md` | Workflow instructions |
| `voice-agent/prompts/kelly-voice-agent-prompt.md` | Kelly prompt (6,871 words—source of truth) |
| `voice-agent/prompts/kelly-chat-prompt.md` | Chat triage prompt |
| `voice-agent/prompts/sales-agent-prompt.md` | **Empty file** — delete |
| `architecture/voice-agent/RUNBOOK.md` | Imports, ops |
| `architecture/voice-agent/TOOL_SCHEMAS.md` | Tool reference |

**Consolidation:**
- Keep: `kelly-voice-agent-prompt.md`, `kelly-chat-prompt.md`, `RUNBOOK.md`, `TOOL_SCHEMAS.md`.
- Merge: `MEDICAL_CODING_AGENT_TODO` + `AI_AGENT_FINANCIAL_LAYER_TODO` + `IMPLEMENTATION_STATUS` → **`architecture/voice-agent/VOICE_AGENT_TODO_AND_STATUS.md`**.
- Delete: `MEDICAL_CODING_AGENT_PROMPT` (redundant with Kelly prompt), `medical-voice-agent-prompt.md` (merge key rules into RUNBOOK or Kelly prompt), `sales-agent-prompt.md` (empty).

---

### 3.5 Patient Architecture (6 docs)

| Doc | Purpose |
|-----|---------|
| `PATIENT_VOICE_BOOKING_ARCHITECTURE.md` | 9-step flow (3,615 words) |
| `PATIENT_WEB_PORTAL_TODO.md` | Portal pending work |
| `TELEHEALTH_MVP_TODOS.md` | Telehealth backlog (2,409 words) |
| `LOCAL_E2E_RUNBOOK.md` | Local E2E runbook |
| `LOCAL_LANDING_TEST_FLOW.md` | Landing + portal test |
| `PATIENT_UI_SOURCE_OF_TRUTH.md` | UI layout/theme |
| `TRIAGE_SESSION_SCOPE.md` | Triage session lifecycle |
| `PATIENT_WALLET.md` | Wallet MVP |
| `LITTLELAB_LANDING_AND_SIGNUP_TODO.md` | Landing, search, signup |

**Consolidation:** Merge into **2–3 docs**:
1. **`PATIENT_ARCHITECTURE.md`** — Merge PATIENT_VOICE_BOOKING + TRIAGE_SESSION_SCOPE + PATIENT_UI.
2. **`PATIENT_PORTAL_AND_TELEHEALTH_TODO.md`** — Merge PATIENT_WEB_PORTAL_TODO + TELEHEALTH_MVP_TODOS + LITTLELAB_LANDING.
3. **`LOCAL_TEST_RUNBOOK.md`** — Merge LOCAL_E2E + LOCAL_LANDING.
- `PATIENT_WALLET.md` — Keep (short, distinct).

---

### 3.6 Deployment (23 docs → ~12)

Overlap in deployment checklists, DNS, SSL, Azure. Suggested merges:

| Merge | Into | Delete |
|-------|------|--------|
| `DEPLOYMENT_CHECKLIST.md` + `final-deployment-checklist.md` | Single `DEPLOYMENT_CHECKLIST.md` | `final-deployment-checklist.md` |
| `IONOS_A_RECORD_SETUP.md` + `IONOS_DNS_CONFIGURATION.md` | `deployment/dns/IONOS_DNS_SETUP.md` | Both |
| `TENANT_SUBDOMAIN_SETUP.md` + `SUBDOMAIN_SSL_FIX.md` + `WILDCARD_DNS_EXPLANATION.md` | `TENANT_AND_DNS_SETUP.md` | Others |
| `QUICK_DEPLOYMENT_GUIDE.md` + `DEPLOYMENT_GUIDE.md` | Keep both (quick vs full) or merge | Optional |

---

### 3.7 Placeholder / Thin Folders (Delete or Merge)

| Folder | Content | Action |
|--------|---------|--------|
| `analysis/` | README only (placeholder) | **Delete folder** — move README content to main docs README |
| `reports/` | README only (placeholder) | **Delete folder** — same |
| `archive/` | README + azure-debug-scripts ref | **Keep** — but ensure azure-debug-scripts exists or remove reference |
| `products/` | CBD product docs (4 files) | **Evaluate** — if CBD is deprecated, archive entire folder |

---

### 3.8 Architecture Subfolder Bloat (54 docs)

`architecture/` has many subsections. Consolidation by subsection:

| Subsection | Count | Action |
|------------|-------|--------|
| financial | 9 | Merge to 2 (see 3.2) |
| voice-agent | 12 | Merge to ~6 (see 3.4) |
| patients | 9 | Merge to 3 (see 3.5) |
| payments | 4 | Merge Stripe Issuing (see 3.3); keep PAYMENT_ARCHITECTURE, PAYMENT_ENV_AND_FLOWS |
| middleware | 2 | Merge MIDDLEWARE_BRAIN_GAP + IMPLEMENTATION → 1 |
| maintenance | 2 | Merge FIXES_APPLIED into ARCHITECTURE_ISSUES or delete if superseded |
| intelligence-layer | 3 | Keep README; consider merging LAYER1 + MULTIMODAL into 1 |
| database | 1 | Keep |
| multi-tenant | 2 | Keep both |
| ai | 1 | Keep |
| media | 1 | Keep |
| branding | 1 | Keep |
| healthcare | 1 | Keep |
| vision | 1 | Keep |

---

## 4. Summary: Reduction Targets

| Action | Before | After | Savings |
|--------|--------|-------|---------|
| Root patient/triage/matching | 5 | 2 | 3 |
| Financial | 5 | 2 | 3 |
| Stripe Issuing | 5 | 1 | 4 |
| Voice agent TODOs/status | 5 | 1 | 4 |
| Patient architecture | 9 | 3 | 6 |
| Deployment checklists/DNS | ~6 | ~3 | ~3 |
| Placeholder folders | 2 folders | 0 | 2 |
| Empty file | 1 | 0 | 1 |
| Architecture maintenance/middleware | 4 | 2 | 2 |
| **Total estimated** | **167** | **~90–100** | **~40–50%** |

---

## 5. Recommended Execution Order

### Phase 1 — Quick Wins (No Content Loss)
1. Delete `voice-agent/prompts/sales-agent-prompt.md` (empty).
2. Delete `analysis/` and `reports/` folders (placeholder READMEs only).
3. Update `docs/README.md` to remove references to deleted docs.

### Phase 2 — Consolidate Patient/Triage/Matching
4. Create `PATIENT_BOOKING_AND_TRIAGE_GAPS.md` (merge 4 root docs).
5. Delete: `TRIAGE_AND_MATCHING_GAPS.md`, `SPECIALIST_MATCHING_IMPROVEMENT_PLAN.md`, `CLINICAL_MARKETPLACE_TODOS.md`.
6. Keep `meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md`.
7. Update `PATIENT_BOOKING_AND_JOURNEY.md` → redirect or rename to consolidated doc.

### Phase 3 — Financial & Stripe
8. Merge Tiba + billing → `TIBA_AND_BILLING_TODO.md`.
9. Merge Stripe Issuing → single `STRIPE_ISSUING.md`.
10. Update `docs/README.md` links.

### Phase 4 — Voice Agent & Patient
11. Merge voice agent TODOs/status.
12. Merge patient architecture docs.
13. Merge deployment checklists where reasonable.

### Phase 5 — Final Pass
14. Update all cross-references in remaining docs.
15. Add "Last Updated" to consolidated docs.
16. Run link checker (e.g. `markdown-link-check`) to catch broken links.

---

## 6. Files to Delete (After Merge)

| File | Reason |
|------|--------|
| `voice-agent/prompts/sales-agent-prompt.md` | Empty |
| `analysis/README.md` | Placeholder; folder delete |
| `reports/README.md` | Placeholder; folder delete |
| `TRIAGE_AND_MATCHING_GAPS.md` | Merged into PATIENT_BOOKING_AND_TRIAGE_GAPS |
| `SPECIALIST_MATCHING_IMPROVEMENT_PLAN.md` | Merged |
| `CLINICAL_MARKETPLACE_TODOS.md` | Merged |
| `architecture/financial/TIBA_FINANCIAL_LAYER_GAP_ANALYSIS.md` | Merged |
| `architecture/financial/TIBA_FINANCIAL_LAYER_GAP_REMEDIATION_TODO.md` | Merged |
| `architecture/financial/TIBA_FINANCIAL_LAYER_TODO.md` | Merged |
| `architecture/financial/BACKEND_BILLING_REVIEW.md` | Merged |
| `integrations/stripe/issuing/STRIPE_ISSUING_STATUS.md` | Merged |
| `integrations/stripe/issuing/STRIPE_ISSUING_ON_DEMAND.md` | Merged |
| `architecture/payments/STRIPE_ISSUING_IMPLEMENTATION.md` | Merged |
| `architecture/payments/STRIPE_ISSUING_INTEGRATION.md` | Merged |
| `setup/stripe/STRIPE_ISSUING_COMPLETE_GUIDE.md` | Merged (content moved to integrations) |
| `architecture/voice-agent/MEDICAL_CODING_AGENT_TODO.md` | Merged |
| `architecture/voice-agent/AI_AGENT_FINANCIAL_LAYER_TODO.md` | Merged |
| `architecture/voice-agent/IMPLEMENTATION_STATUS.md` | Merged |
| `architecture/voice-agent/MEDICAL_CODING_AGENT_PROMPT.md` | Redundant with Kelly prompt |
| `voice-agent/medical-voice-agent-prompt.md` | Merge into RUNBOOK |
| (Patient architecture merges—see 3.5) | |
| (Deployment merges—see 3.6) | |

---

## 7. Single Source of Truth After Consolidation

| Topic | Canonical Doc |
|-------|---------------|
| Patient booking flow & gaps | `PATIENT_BOOKING_AND_TRIAGE_GAPS.md` |
| Richer triage & records Q&A | `meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md` |
| Financial architecture | `architecture/README.md#financial-financial-layer-architecture` |
| Tiba & billing todos | `architecture/README.md#financial-tiba-and-billing-todo` |
| Stripe Issuing | `integrations/README.md#stripe-issuing-stripe-issuing` |
| Kelly prompt (voice) | `voice-agent/prompts/kelly-voice-agent-prompt.md` |
| Kelly prompt (chat) | `voice-agent/prompts/kelly-chat-prompt.md` |
| Voice agent ops | `architecture/README.md#voice-agent-runbook` |
| Main setup | `setup/README.md#getting-started-setup` |
| Deployment | `deployment/README.md#guides-deployment-guide` |


---

<a id="gap-analysis-richer-triage-and-records"></a>

## Gap Analysis: Richer Triage & Patient Records Q&A

*Former path: `docs/meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md`*

**Purpose:** Side-by-side comparison of **what exists today** vs **what needs to be built** for:
1. **Richer triage** — family history, meds, prior workups, allergies → better specialist matching
2. **Patient document as source of truth** — “Ask about my records,” document Q&A

---

## Summary Table

| Area | Current State | Required State | Gap Severity |
|------|---------------|----------------|---------------|
| **Triage schema** | OPQRST only | + family_history, medications, prior_diagnoses, prior_workups, allergies, critical_unknowns | High |
| **Kelly intake** | Specialty-specific prompt hints (gap6); no structured tools | Store & pass rich intake; tools for each block | High |
| **TriageRAG input** | symptom + OPQRST | symptom + OPQRST + family history + meds + prior workups | Medium |
| **Specialist matching** | Single specialty from ICD/keywords | Differential-based; multi-specialty when relevant | Medium |
| **Patient documents** | Upload, storage, list | Patient-scoped retrieval; Q&A over documents | High |
| **Records Q&A** | None | Intent detection; patient RAG; Kelly tool | High |
| **Colab/Patient RAG v3.2** | External pipeline; not integrated | Middleware API for patient-scoped queries | High |

---

## 1. Triage Schema

### Current State

**`triage_sessions`** (migration 008):
- `onset`, `provocation`, `quality`, `radiation`, `severity`, `timing`, `associated_sx`
- `media_requested`, `media_received`, `media_ids`, `opqrst_complete`, `triage_complete`
- `target_specialty`, `safety_level`, `urgency`, `rag_result_id`, `referred_to_911`

**`triage_rag_results`**:
- `symptom_text`, `opqrst_json`, `icd_codes`, `cpt_codes`, `target_specialty`, `secondary_specialties`
- `urgency`, `safety_level`, `red_flags`, `recommended_lane`, `patient_friendly_summary`, `specialist_context`
- `soap_note` (gap14), `rag_confidence` (gap13)

### Required State

| Column | Purpose | Where |
|--------|---------|-------|
| `family_history` | Cardiac hx, cancer, etc. for better specialty routing | triage_sessions |
| `medications` | Current meds list (JSON or text) | triage_sessions |
| `prior_diagnoses` | Known conditions | triage_sessions |
| `prior_workups` | Prior ECG, labs, imaging | triage_sessions |
| `allergies` | Drug/food allergies | triage_sessions |
| `alcohol_use` | Substance history (when relevant) | triage_sessions |
| `substance_use` | Substance history | triage_sessions |
| `critical_unknowns` | List of things still unknown before routing | triage_sessions |

**Schema change:** New migration to add these columns to `triage_sessions` and optionally persist in `triage_rag_results` for audit.

---

## 2. Kelly Agent Intake

### Current State

- **Prompt (gap6):** Specialty-specific deep-dive hints (Cardiology: family history, meds; Derm: spreading, products; Psych: PHQ-2/GAD-2).
- **Prompt (gap8):** Mental health uses PHQ-2/GAD-2, safety screen instead of radiation.
- **Tools:** `store_triage_opqrst` (OPQRST only), `get_triage_session`, `run_triage_rag`.
- **No tools** for storing family history, medications, prior diagnoses, prior workups, allergies.

### Required State

| Component | Change |
|-----------|--------|
| **New tool** | `store_triage_rich_intake` — accepts `family_history`, `medications`, `prior_diagnoses`, `prior_workups`, `allergies`, `critical_unknowns` |
| **Or extend** | `store_triage_opqrst` to accept these fields (schema must support) |
| **Prompt** | After RAG suggests specialty, Kelly asks specialty-specific rich questions and stores via tool before calling `run_triage_rag` |
| **Flow** | get_triage_session → merge OPQRST + rich intake → pass all to run_triage_rag |

---

## 3. TriageRAGService Input & Logic

### Current State

**`_buildCombinedText(symptomText, opqrst)`** — concatenates:
- symptomText
- Onset, quality, severity, radiation, timing, associated_sx

**No use of:** family history, medications, prior diagnoses, prior workups, allergies.

**`_resolveSpecialty(text, icdCodes)`**:
- Keyword match (SYMPTOM_SPECIALTY_KEYWORDS)
- ICD prefix → specialty (ICD_SPECIALTY_MAP)
- Returns single `specialty` + `secondarySpecialties` (keyword overlap)
- **No differential-based routing**

### Required State

| Component | Change |
|-----------|--------|
| **`_buildCombinedText`** | Append `family_history`, `medications`, `prior_diagnoses`, `prior_workups`, `allergies` when present |
| **`enrichFromSymptoms`** | Accept `richIntake` object in params; merge into combinedText before RAG |
| **Specialty resolution** | If Colab/external RAG returns differentials → map differentials to specialties; support multi-specialty when several specialists relevant |

---

## 4. Knowledge Service & RAG

### Current State

- **Input:** `clinicalNote` (string) — no `patientId`, no document-scoped context.
- **`getCodeCandidates` / `getCodeCandidatesDualSource`**:
  - Local: keyword extraction, phrase matching, DB search (icd10, cpt, hcpcs)
  - Remote: `retrieveFromColabRAG({ query, specialty, region, exclusion_terms, top_k })` → returns `{ icd10, cpt, hcpcs }` only
- **Colab RAG:** Returns codes; no differential diagnoses, no patient-specific retrieval.

### Required State

| Component | Change |
|-----------|--------|
| **Patient-scoped retrieval** | New API or option: `getCodeCandidatesForPatient(clinicalNote, { patientId })` — merge in patient document chunks when available |
| **Differentials** | Colab/external RAG would need to return `differentials: [{ condition, specialty, confidence }]` — middleware would consume and route |
| **Document Q&A** | Separate flow: patient asks “what did my last lab say?” → retrieve over `patient_documents` + `case_report_media`; return answer to Kelly |

---

## 5. Document Storage & Indexing

### Current State

| Table | Purpose | Notes |
|-------|---------|-------|
| **patient_documents** | Portal-visible docs (patient_id, file_name, storage_path, encounter_id, appointment_id) | No embedding, no indexing for RAG |
| **case_report_media** | Triage/case uploads (session_id, patient_id, file_name, context_note, ai_analysis) | Used by `getTriageMediaForSession`; ai_analysis optional |

**`getTriageMediaForSession(sessionId)`**:
- Returns media for session
- `_runTriageRAG` concatenates `ai_analysis` / `context_note` / `file_name` into symptomText

**Dual-write:** Patient portal uploads can mirror into `patient_documents`; triage uploads go to `case_report_media` (server.js).

### Required State

| Component | Change |
|-----------|--------|
| **Indexing** | Chunk and embed `patient_documents` + `case_report_media` (or sync to external RAG) for patient-scoped retrieval |
| **Patient-scoped retrieval** | `retrievePatientDocuments(patientId, query)` → relevant chunks for Q&A |
| **Triage flow** | Continue feeding session media into triage; add option to also pull prior patient docs when patientId known |

---

## 6. “Ask About My Records” Flow

### Current State

- **None.** No intent detection for “ask about my records,” “what did my lab say,” “do I have any allergies on file.”
- Patient portal has “My Records” (my-records.html) — list/download only, no Q&A.

### Required State

| Step | Implementation |
|------|----------------|
| **Intent** | Kelly or routing layer detects “records question” (keyword/heuristic or LLM) |
| **Patient context** | Must have `patientId` (from session/auth) |
| **Tool** | `query_patient_records` — params: `patient_id`, `query` (natural language) |
| **Backend** | Patient-scoped RAG over documents + structured data (allergies, meds if in FHIR) |
| **Response** | Return answer + optional doc references; Kelly narrates |

---

## 7. Specialist Matching

### Current State

- **TriageRAGService** → `target_specialty` (single) + `secondary_specialties` (up to 2 from keyword overlap)
- **SpecialistResolverService** → resolves `{ specialty, ... }` → providers Map
- **getAvailableSlotsWithSpecialist** → slots for those providers
- **Flow:** Symptom → ICD/CPT → keyword/ICD map → one primary specialty

### Required State

| Scenario | Change |
|----------|--------|
| **Differentials** | If RAG returns differentials → map each to specialty; consider top 1–2 for routing |
| **Multi-specialty** | When several specialists relevant (e.g. cardiology + endocrinology for diabetic chest pain), either primary + secondary or offer both |
| **Rich intake influence** | Family history of heart disease → boost cardiology; prior psych treatment → boost psychiatry |

---

## 8. Patient RAG Pipeline v3.2 (External)

### Current State

- External Colab/Drive pipeline: labs, images, differentials.
- Not integrated with middleware.
- No middleware API that accepts `patientId` + `query` and returns patient-specific answers.

### Required State

| Component | Change |
|-----------|--------|
| **API contract** | `POST /api/patient-rag/query` — `{ patientId, query }` → `{ answer, sources[], confidence }` |
| **Indexing** | Patient docs (labs, imaging reports, notes) chunked and indexed per patient |
| **Middleware integration** | Kelly tool `query_patient_records` calls this API when patient-scoped Q&A intent detected |

---

## 9. Implementation Priority

### P0 — Unblock richer triage (no records Q&A yet)

1. **Schema:** Add `family_history`, `medications`, `prior_diagnoses`, `prior_workups`, `allergies` to triage_sessions.
2. **Kelly:** Extend `store_triage_opqrst` or add `store_triage_rich_intake`; extend `get_triage_session` to return these.
3. **TriageRAG:** Extend `_buildCombinedText` and `enrichFromSymptoms` to accept and use rich intake.
4. **Prompt:** Strengthen specialty-specific deep-dive; ensure Kelly stores rich intake before `run_triage_rag`.

### P1 — Better specialty resolution

5. **Differentials:** If Colab RAG is extended to return differentials, add mapping to specialties in TriageRAG.
6. **Multi-specialty:** Use `secondary_specialties` more actively in resolver when confidence is split.

### P2 — Patient records Q&A (separate track)

7. **Intent:** Detect “ask about my records” in Kelly or routing.
8. **Tool:** `query_patient_records(patient_id, query)`.
9. **Backend:** Patient-scoped RAG (index patient_documents + case_report_media) or integrate v3.2 pipeline.
10. **API:** `POST /api/patient-rag/query` or equivalent.

---

## 10. File-Level Checklist

| File | Changes Needed |
|------|----------------|
| `migrations/011_triage_rich_intake.js` | Add columns to triage_sessions |
| `database.js` | `upsertTriageSession` accept new fields; `getTriageSession` return them |
| `kelly-agent-service.js` | Tool def for rich intake; prompt for specialty-specific questions |
| `kelly-tool-executor.js` | Implement `store_triage_rich_intake` (or extend store_triage_opqrst); pass rich intake to `_runTriageRAG` |
| `triage-rag-service.js` | `_buildCombinedText` include rich intake; `enrichFromSymptoms` accept richIntake |
| `knowledge-service.js` | Optional: `getCodeCandidatesForPatient` when patientId + docs available |
| **New:** `services/patient-rag-service.js` | `queryPatientRecords(patientId, query)` — stub or integrate v3.2 |
| `server.js` | Route `POST /api/patient-rag/query` |
| `remote-rag-client.js` | No change for codes; future: patient-scoped retrieve if Colab supports |

---

## References

- [PATIENT_BOOKING_AND_TRIAGE_GAPS.md](./PATIENT_BOOKING_AND_TRIAGE_GAPS.md) — flow, gap1–gap18, matching, schedule, checkout, UX issues
- [ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md](./architecture/README.md#overview-architecture-overview-and-colab-rag) — RAG integration
- [TRIAGE_CLINICAL_GRADE_ROADMAP.md](../todos/TRIAGE_CLINICAL_GRADE_ROADMAP.md) — actionable todos for 6 stages (history, RAG, differentials, ICD/CPT, matching, SOAP)


