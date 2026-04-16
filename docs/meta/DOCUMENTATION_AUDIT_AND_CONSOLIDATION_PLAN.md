# Documentation Audit & Consolidation Plan

**Last Updated:** April 6, 2026

**See also:** [meta/CANONICAL_DOC_MAP.md](./meta/CANONICAL_DOC_MAP.md) — **where to read first** when Kelly, checkout, and voice docs overlap (living index; update when you add a new “source of truth” doc).

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
| **middleware-platform/** | 25+ | Kelly, checkout runbooks, Retell, LangGraph, security (see [`middleware-platform/README.md`](./middleware-platform/README.md)) |
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
| Financial architecture | `architecture/financial/FINANCIAL_LAYER_ARCHITECTURE.md` |
| Tiba & billing todos | `architecture/financial/TIBA_AND_BILLING_TODO.md` |
| Stripe Issuing | `integrations/stripe/issuing/STRIPE_ISSUING.md` |
| Kelly prompt (voice) | `voice-agent/prompts/kelly-voice-agent-prompt.md` |
| Kelly prompt (chat) | `voice-agent/prompts/kelly-chat-prompt.md` |
| Voice agent ops | `architecture/voice-agent/RUNBOOK.md` |
| Main setup | `setup/getting-started/SETUP.md` |
| Deployment | `deployment/guides/DEPLOYMENT_GUIDE.md` |
