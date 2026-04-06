# Phase 0 — Derm patient Q&A: scope, intent taxonomy, metrics, positioning

This document implements **Phase 0** from `todos/DERM_PATIENT_QA_REDDIT_PIPELINE_TODOS.md` (align and scope). It is the **product + evaluation contract** for the Reddit-informed patient Q&A pipeline (intent router → passage retrieval → grounded answers).

---

## 1. Intent taxonomy (minimum viable)

Every user turn is classified into **exactly one** primary intent before heavy retrieval. The classifier may also emit **`needs_clarification`** when the message is too vague to route safely (e.g. “Please help me” with no detail).

| Intent | Definition | System behavior (high level) | Example inputs |
|--------|------------|--------------------------------|----------------|
| **Urgent** | Possible **malignancy**, **rapidly worsening** infection, **severe** systemic concern, or **red-flag** skin findings as defined in triage rules | **Short** response. **No** long differential. **Emphasize** in-person evaluation **soon** or **emergency** per severity. Retrieval is **minimal** or skipped for pure escalation. | “This mole changed in a week,” “spreading painful red streak,” “whole face swelling after new med” |
| **Education** | User seeks **pattern / mechanism / what to watch for**; may include photos or lay descriptions | **Non-diagnostic** language: patterns, differentials as “what clinicians consider,” **limits** of remote assessment. Retrieval from **education passage** index. **When to see a clinician** always clear. | “Are these closed comedones or fungal acne?”, “rash along hairline after new shampoo” |
| **Routine** | **Products**, **routines**, **cosmetic** concerns, **slow** chronic issues without red flags | **Ingredients**, **expectations** (e.g. timelines), **OTC**-style guidance where appropriate. **No** emergency framing unless new red flags appear. | “Purging month 3 on tretinoin,” “niacinamide vs vitamin C order” |
| **Off-topic / unusable** | **Non-derm**, spam, **unparseable**, or **insufficient** content to act | **Refuse** or **one** targeted **clarifying question**; optional redirect to general help. **No** fabricated clinical content. | Shipping complaints, empty title, “help” with zero context (after one clarify) |

### Clarification sub-state

- **`needs_clarification`**: Not a fourth “answer type” — a **gate** before Education or Routine (or before Urgent if severity is unclear). At most **one** discriminating question per turn (or a small fixed set), then re-route.

### Explicit non-goals for MVP taxonomy

- **Not** diagnosing or naming a definitive condition from text/photo alone for Education/Urgent lanes; **pattern** and **urgency** language only.
- **Not** replacing **911** or local emergency services; urgent path must **tell user** to seek appropriate **in-person or emergency** care when indicated.

---

## 2. Success metrics

### 2.1 Offline (development / CI)

| Metric | What it measures | Target direction | Notes |
|--------|------------------|------------------|--------|
| **Answer relevancy** (e.g. RAGAS) | Does the answer **match the user’s question type**? | ↑ | Primary lever: **intent router** + clarification |
| **Context recall** | Did retrieval surface **needed** evidence? | ↑ | **Passage index** + hybrid search + query expansion |
| **Context precision** | Is retrieved content **on-topic**? | Stay high while recall improves | Avoid flooding irrelevant chunks |
| **Faithfulness** | Is the answer **supported by** retrieved passages? | ↑ | **Grounded templates**, abstain when weak |
| **Clinician-graded sample** | Fixed **golden slice** (e.g. 50–100 rows), blinded rating: safe / appropriate / off | ≥ agreed threshold | Stratify: **high-risk** vs **benign** |
| **Safety violations** | Count of **dangerous** outputs (e.g. “watch at home” for high-risk templates) | **0** on golden red-flag set | Hard gate |

**Regression rule (recommended):** On each release candidate, re-run the **same** golden JSON + RAGAS; **fail** the build if relevancy or faithfulness **drops** beyond an agreed delta vs baseline.

### 2.2 Online (production)

| Signal | Use |
|--------|-----|
| **Thumbs up / down** | Trend and cohort by intent |
| **Escalation taps** | “Book” / “Urgent care” / “Talk to a doctor” — rate and downstream completion if tracked |
| **Abstention / clarify rate** | Fraction of turns that **ask one question** or **decline** to answer — high is OK if vague-input rate is high; **monitor** for frustration |
| **Harm reports** | Manual triage queue for “unsafe” or “wrong” flags |

---

## 3. Regulatory and product positioning

### 3.1 Positioning (MVP)

- The feature is **patient education and navigation**, **not** a **medical diagnosis** or **substitute** for a licensed clinician.
- **Output framing:** Informational only; **“may,” “could,” “often,”** and **uncertainty** where appropriate; **encourage** professional evaluation when appropriate.

### 3.2 Disclaimers (required in UI + acceptable in API payload metadata)

- **Not emergency care** — for emergencies, call local emergency number / seek immediate care.
- **Not a diagnosis** — any condition names are **educational context**, not a label for the user’s body.
- **Photos / text limits** — remote assessment has **limits**; in-person exam and tests may be needed.

*(Exact copy is owned by Legal/Clinical; engineering surfaces `disclaimer_tier` or static strings per product.)*

### 3.3 Age, pregnancy, and special populations

- **Pediatric / adolescent:** Use **extra caution**; default stance: **prefer** caregiver-led **in-person** evaluation for ambiguous or evolving lesions; avoid definitive reassurance.
- **Pregnancy / lactation:** Do **not** recommend prescription or systemic therapies without clinician context; **OTC/general** education only unless integrated with clinician workflow.
- **Implementation:** Encode as **policy flags** on intent + retrieval filters (`population: pediatric | adult | unknown`) when intake supplies age; otherwise **conservative** language.

### 3.4 Data and eval data (Reddit / JSON)

- Reddit-derived **queries** are used for **evaluation and query understanding**, not as **medical authority**.
- **Ground-truth** text in gold files is **editorial / reference** until **clinician** sign-off on a **frozen** eval slice.

---

## 4. References

- Todo roadmap: `todos/DERM_PATIENT_QA_REDDIT_PIPELINE_TODOS.md`
- RAG integration overview: `docs/architecture/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`
- Triage rules (reuse for red flags): `Knowledge/rules/triage-rules.json` (paths may vary)

---

*Document version: 1.0 — Phase 0 implementation.*
