# Skin & Care — Step 2 paths, report shape, and Step 1 inputs

**Status:** Phase 2 product spec + Phase 2.5 schema design lock (before tool/prompt wiring).  
**Companion:** Column definitions and enums are duplicated in the header of `migrations/021_skincare_assessment_columns.js` (single source for DB shape).

---

## 1. Four paths out of Step 2 (entry criteria)

Paths are **not mutually exclusive** in data: Step 2 output may include a **primary path** plus **secondary flags** (e.g. education + routine builder). Entry criteria below define when each path is **in play**.

| ID | Path | Entry criteria (all weighted; use strongest match for primary UX) |
|----|------|---------------------------------------------------------------------|
| **A** | **Routine builder** | User wants a **structured routine** (AM/PM steps, order, frequency) or already has products and wants optimisation. **Not** the dominant path when the user only asked “what should I buy?” with no routine intent. |
| **B** | **Product recommendation** | User is **shopping-oriented** or has **no meaningful routine** and wants specific product types or ingredients (not full step sequencing). Concerns are captured; routine depth is optional. |
| **C** | **Clinical referral flag** | Any of: **functional_impact** ≥ 4; **prior_dermatologist.seen** is false and presentation warrants professional evaluation; **safety red flags** (orchestrator / safety layer); user **asks** to see a clinician. Produces a **flag** for copy and routing — not automatic booking unless product says so. |
| **D** | **Education only** | User **explicitly** wants to understand (ingredients, conditions in lay terms, “why”) **without** asking for a purchasable routine or products as the main outcome. Default **secondary** when other paths also apply unless user narrows to “just explain.” |

**Primary path resolution (recommended):**  
1. If **C** triggers → surface referral/education-first framing; still allow A/B content if user continues.  
2. Else if **D** is explicit → **D** primary.  
3. Else if user has **routine or product list** and wants steps → **A** primary.  
4. Else → **B** primary.

---

## 2. Minimum report contents (Step 2 deliverable)

The **report** (or first “assessment complete” response) should include, in **lay language**:

1. **Captured summary** — What we understood: concerns, skin type, safety context (pregnancy/breastfeeding), environment/lifestyle **if collected**, triggers **if collected**, prior derm **if collected**.  
2. **What the presentation might suggest** — **Non-diagnostic** framing (“often seen with…”, “could be consistent with…”) — no definitive disease labels as fact.  
3. **Category of help** — Which path(s) apply: routine vs products vs consider seeing a clinician vs education — in one short paragraph.  
4. **Next step (soft CTA)** — Aligned with primary path (e.g. routine outline, product directions, gentle escalation copy, or “here’s what to watch for”).

**Must not:** present **formal diagnosis**, replace **emergency** instructions, or promise **clinical outcomes**.

---

## 3. Map paths → required Step 1 inputs

### 3.1 Eleven first-class columns (`triage_sessions`)

| Column | Role in paths |
|--------|----------------|
| `skin_type` | **A, B** — essential for product/routine fit. |
| `skin_concerns_json` | **A, B, C, D** — at least one concern for any path. |
| `pregnancy_status` | **A, B, C, D** — **safety**; gates certain actives in copy. |
| `prior_dermatologist_json` | **C** heavily; **D** for tone (“your derm said…”). |
| `functional_impact` | **C** primary driver; **A/B** for intensity of language. |
| `ingredient_reactions` | **A, B** — avoid bad recommendations. |
| `what_has_worked` | **A, B, D** — retrieval and “don’t restart from zero.” |
| `hormonal_context` | **A, B, D** — life-stage framing without cycle tracking. |
| `lifestyle_notes` | **A, D** (optional **B**) — context for behaviour-related copy. |
| `environment_notes` | **A, B, D** — climate, water, sun, pollution. |
| `triggers_json` | **A, D** (and **C** when pattern suggests escalation) — pattern education. |

### 3.2 Completion gates (spec — implementation follows in Phase 4)

| Tier | Requirement |
|------|-------------|
| **Hard (must have before `intake_complete` / `skincare_post_intake`)** | `skin_type` answered · ≥1 concern in `skin_concerns_json` · `pregnancy_status` · `prior_dermatologist_json.seen` (boolean or tri-state) answered · `functional_impact` (1–5). |
| **Soft (should have)** | Explicit routine or “no routine yet” · `triggers_json` when concern type warrants (e.g. episodic flares). |
| **Nice to have** | `lifestyle_notes`, `environment_notes`, `ingredient_reactions`, `what_has_worked`, `hormonal_context` — completion may fire with **tracked gaps** for Kelly/report (Phase 4). |

### 3.3 Path × hard fields (validation matrix)

| Field | A | B | C | D |
|-------|---|---|---|---|
| skin_type | ✓ | ✓ | ✓ | ○ |
| skin_concerns_json | ✓ | ✓ | ✓ | ✓ |
| pregnancy_status | ✓ | ✓ | ✓ | ✓ |
| prior_dermatologist_json | ○ | ○ | ✓ | ○ |
| functional_impact | ○ | ○ | ✓ | ○ |

✓ = required for **meaningful** path output; ○ = optional but improves copy. **Global hard gates** still require all five hard fields before completion.

---

## 4. Storage formats (Task 22 summary)

Detailed allowed values and JSON shapes are in **`021_skincare_assessment_columns.js`** (migration header).  
**Application layer:** validate on write; store only allowed enums or `unknown` / `prefer_not_say` where defined.

---

## 5. Related code (later phases)

| Phase | Work |
|-------|------|
| 3 | `upsertTriageSession` / tools persist these columns. |
| 4 | `_syncRoutineSkincareIntakeMeta` enforces hard gates + gap metas. |
| 4b | API payload exposes `skincare_assessment_complete` / `next_ui_step`. |
| 5 | `formatRoutineIntakeSummaryFromTriageRow` includes new fields + media state. |
