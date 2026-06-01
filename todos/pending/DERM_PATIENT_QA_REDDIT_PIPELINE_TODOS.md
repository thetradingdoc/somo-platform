# Derm patient Q&A — open backlog (UI, eval, ops)

**Status:** Backend pipeline complete (Phases 0–5) — see [`../archive/DERM_PATIENT_QA_BACKEND_COMPLETED_2026-05-31.md`](../archive/DERM_PATIENT_QA_BACKEND_COMPLETED_2026-05-31.md)

**North star:** *Right evidence for the right fear — fast, safe, and specific to skin.*

---

## Open — clinician sign-off

- [ ] **P1.4** Clinician spot-check a sample of `ground_truth` for clinical safety and tone — process in [`Knowledge/eval/CLINICIAN_SPOT_CHECK.md`](../../Knowledge/eval/CLINICIAN_SPOT_CHECK.md) *(manual sign-off)*

---

## Phase 8 — UI / UX (frontend; not backend-only)

The pipeline todos above are **mostly middleware + RAG + eval**. Patient-facing value ships only when the **UI** reflects intent routing, safety, and limits. Align with existing surfaces: **patient app (Expo)**, **unified-dashboard** HTML (e.g. `checkout-chat`, patient portal), **littlelab-landing** (marketing / RAG search cards).

- [ ] **P8.1** **Chat surface** — wire the derm Q&A API (or Step10) into the **primary patient chat** (or a dedicated “Skin Q&A” mode):
  - [ ] Loading / streaming states (retrieval can be slow)
  - [ ] **Intent-aware layout**: urgent = prominent “seek care” CTA; education = collapsible “why we’re not diagnosing”; routine = product/book chips if applicable
- [ ] **P8.2** **Clarifying questions** — UI for **one** follow-up when the router returns `needs_clarification` (not a wall of text)
- [ ] **Disclaimers** — persistent or per-message: **not a diagnosis**, **not emergency services**, jurisdiction-appropriate copy
- [ ] **Escalation paths** — buttons: **Book dermatologist** / **Urgent care** / **Continue chat**; deep-link to booking if you already have appointment flows (`TELEMEDICINE_TODOS`, booking service)
- [ ] **Citations (optional)** — “Sources” expander with short labels (guideline vs internal brief); match **P4.3** backend contract
- [ ] **Feedback** — thumbs up/down + optional reason; feeds **P6.4** online eval
- [ ] **Image upload / camera** (if in scope) — show caption preview, **cannot diagnose from photo alone** copy before send
- [ ] **Accessibility** — large tap targets, readable contrast for urgent banners (WCAG-minded)
- [ ] **Landing / marketing** — `littlelab-landing` **RAG search** (`useRAGSearch`) is **ontology/code**-shaped today; decide if Skin marketing stays separate from **patient education** pipeline or gets a **second** API for passage-style “learn more” cards
- [ ] **Voice (Retell / Kelly)** — if voice uses the same agent: **spoken** urgent vs education templates; barge-in; repeat last “next step”

**Dependency:** Phase **5** (stable API + response schema: `intent`, `answer_type`, `body`, `next_step`, `clarifying_question?`, `sources?`) before shipping **P8.1**.

---

## Phase 6 — Evaluation and CI

- [ ] **P6.1** **Offline runner**: script (Node or Python) that loads `golden_v1`, runs triage → retrieve → generate, writes **per-example** JSON (predicted intent, chunks, answer)
- [ ] **P6.2** **Metrics**:
  - [ ] Retrieval: recall@k of **gold chunk ids** or concept match; track **accuracy_gap**-style specialty mismatches over time
  - [ ] Generation: RAGAS or similar (faithfulness, answer relevancy) — compare to your baseline `ragas_results.json`
  - [ ] Safety: red-flag cases must **never** get “watch at home” as top recommendation
- [ ] **P6.3** **CI hook** (optional): run eval subset on PRs; fail on regression thresholds
- [ ] **P6.4** **Online**: thumbs down / “harmful” / escalate to human — feed back into corpus and prompts

---

## Phase 7 — Ops and governance

- [ ] **P7.1** **Corpus versioning** and changelog (what changed, when, why)
- [ ] **P7.2** **Conflict policy** when sources disagree (AAD vs general web — if web allowed at all)
- [ ] **P7.3** **Incident playbook**: bad answer surfaced in prod → trace (intent, chunks, model version)

---

## Dependencies on existing platform (do not duplicate blindly)

| Existing asset | Use for |
|----------------|--------|
| `triage-rag-service`, `symptom-triage-service`, `Knowledge/rules/triage-rules.json` | Risk signals, scheduling alignment |
| `knowledge-service.getCodeCandidatesDualSource` | Codes / billing lane; may **not** suffice alone for lay answers |
| `buildSearchIntent` + perceptual state | When Layer 1 exists (image/text structured), high-quality query |
| `routes/rag-search.js` | Ontology search for **landing**; different from full patient Q&A |
| Step10 LangGraph | Orchestration hook for L1→L6-style flow |
| `patient-app/`, `unified-dashboard/patients/`, `littlelab-landing/` | UI surfaces for chat, portal, marketing |

---

## Quick reference: order of work

1. **Triage + intent** (Phase 2)  
2. **Eval slice + runner** (Phase 1 + 6) — so every change is measurable  
3. **Passage index + hybrid retrieval** (Phase 3)  
4. **Answer templates + abstention** (Phase 4)  
5. **API / Step10** (Phase 5) — **lock response schema for UI**  
6. **UI / UX** (Phase 8) — in parallel once API contract is stable  
7. **Governance** (Phase 7)

---

*Last updated: Phase 0 spec in `docs/architecture/README.md#derm-patient-qa-phase-0-scope-and-metrics`; Phase 8 UI/UX; RAGAS diagnosis; Reddit/golden eval.*
