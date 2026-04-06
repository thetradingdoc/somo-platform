# Derm patient Q&A pipeline — Reddit-informed world model + triage-first

**Purpose:** Track work to answer **real patient-shaped queries** (vague titles, worry, family/third-party, routine product questions) using **triage-first routing**, **grounded retrieval**, and **safe answers** — aligned with the platform architecture (`knowledge-service`, Colab RAG, triage, optional Step10).

**North star:** *Right evidence for the right fear — fast, safe, and specific to skin.*  
**Not:** memorizing Reddit; **yes:** using Reddit + gold sets as a **distribution of how people ask** and as an **offline eval harness**.

---

## RAGAS baseline — what the numbers imply (fix order)

Baseline from offline eval (example: `ragas_results.json`). These are a **diagnosis**, not final truth — re-run after each phase.

| Metric | Example | Interpretation |
|--------|---------|----------------|
| **Context precision** | ~0.80 | When retrieval returns chunks, they are **often relevant** — index has **signal**. |
| **Context recall** | ~0.27 | Retrieval is **missing most** of what the answer needed — **wrong index shape** (code/billing vs patient language), not “only” a bigger embedding model. |
| **Faithfulness** | ~0.34 | The model **fills gaps** from parametric knowledge instead of **sticking to retrieved passages** — fix **generation / grounding** after retrieval is sane. |
| **Answer relevancy** | ~0.15 | The answer is the **wrong type** for the question — fix **intent routing first**; otherwise retrieval and prompts fight the wrong battle. |

**Inference:** Precision says the pipeline can find *something* useful when it searches the right place; low recall says **patients don’t speak ICD** and the **passage index** for education is missing or misaligned. Low faithfulness says **prompts/templates** must enforce “only from evidence.” Low relevancy says **“Please help me”** and similar get the wrong playbook (e.g. clinical differential instead of **one clarifying question**).

**Recommended fix order (matches phases below):**

1. **Answer relevancy → intent router** — classify *urgent / education / routine / garbage* (and “needs clarification”) **before** retrieval so answer *type* matches query *type*. Relevancy can jump **without** changing the index.
2. **Context recall → passage index** — **parallel** derm education corpus (guidelines, explainers), **hybrid** dense + keyword + **reranker**; keep **code RAG** (`RAG_API_URL`) for billing/coding; use **`RAG_EDUCATION_URL`** (or equivalent) for patient-facing passages.
3. **Faithfulness → grounded templates** — explicit rules: if passages don’t support a claim, **abstain** or ask **one** discriminating question; **no** filler from model opinion.

**Coverage gap reminder:** very large **uncategorised** buckets (e.g. thousands of misses on **“Please help me”**) are **router + clarification** problems — treat as P0 for intent routing, not as “add more chunks.”

---

## The three things you are actually building

1. **Intent router** — Maps messy input (including “Please help me” + follow-up context) into **urgent / education / routine / garbage** before retrieval. Mostly **rules + small classifier**; routes urgent to **see someone**, garbage to **refuse/redirect**, else continues the pipeline.
2. **Passage index (separate from code index)** — Derm-first **text chunks** with hybrid retrieval + rerank; **not** a longer ICD/CPT list.
3. **Grounded answer templates** — One template family per non-garbage bucket (e.g. urgent: short + next step; education: pattern language + limits; routine: habits/products + expectations). **No** gap-filling from latent knowledge when evidence is thin.

The **eval loop** (golden dataset + RAGAS + gap reports) proves each of the three is working and prevents regressions.

### Pipeline diagram (target architecture)

```mermaid
flowchart TB
  A[Patient message] --> B[Step 1 — Intent router]
  B -->|urgent| U[See someone — minimal retrieval]
  B -->|garbage| G[Refuse / redirect]
  B -->|education / routine| C[Step 2 — Query expansion\nsynonyms + optional one clarifying Q]
  C --> D[Step 3 — Passage retrieval\nderm corpus — hybrid + rerank]
  D -->|weak signal| E[Step 4 — Grounded answer\nevidence → limits → one next step]
  D --> E
  E --> R[Reassurance + watch / Try OTC or product / See clinician]
  E --> F[Step 5 — Eval loop\ngolden dataset + RAGAS + gap reports]
  F -.-> B
```

---

## Phase 0 — Align and scope ✅ (see spec)

**Implemented in:** [`docs/architecture/derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md`](../docs/architecture/derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md)

- [x] **P0.1** Document the **intent taxonomy** you will implement (minimum viable):
  - [x] Urgent / possible malignancy or severe infection → short answer + in-person/urgent care path
  - [x] Education / “what could this be?” → non-diagnostic pattern language + when to see a clinician
  - [x] Routine / products / routines → ingredients, expectations, no emergency framing
  - [x] Off-topic / non-derm / unusable → refuse, redirect, or one clarifying question  
  *(Plus **`needs_clarification`** gate and explicit non-goals — in doc §1.)*
- [x] **P0.2** Define **success metrics** (offline + online): e.g. clinician-graded relevance on a **fixed golden slice**, escalation rate, thumbs, abstention rate when evidence is weak  
  *(RAGAS dimensions + regression rule + online signals — in doc §2.)*
- [x] **P0.3** Confirm **regulatory / product** positioning: patient education vs diagnosis; disclaimers; age/pregnancy gates if you claim them  
  *(Disclaimer stance, pediatrics, pregnancy/lactation — in doc §3; Legal/Clinical owns final copy.)*

---

## Phase 1 — Data: world understanding (Reddit + gold) ✅

Reddit-derived JSON is a **map of query behavior**, not ground-truth medicine until reviewed.

**Artifacts:** `Knowledge/eval/datasets/`, `Knowledge/eval/baselines/`, `Knowledge/eval/scripts/build-golden-slices.cjs`, `Knowledge/eval/CLINICIAN_SPOT_CHECK.md`

- [x] **P1.1** **Vendor** `golden_dataset.json` (or `golden_v1.json`) into the repo under e.g. `Knowledge/eval/datasets/` (or document path if data stays private) — **`Knowledge/eval/datasets/golden_dataset.json`**
- [x] **P1.2** **Clean** the eval set:
  - [x] Remove or label **non-derm** rows (shipping, megathreads, etc.) — **`golden_dataset_cleaned.json`** + **`golden_dataset_dropped.json`**; heuristics in **`build-golden-slices.cjs`**
  - [x] Split **natural-language questions** vs **keyword-only** synthetic lines (evaluate separately) — field **`eval_phase1.query_style`**
  - [x] Tag **language** (EN vs mixed) for retrieval testing — **`eval_phase1.language`**
- [x] **P1.3** Build a **stratified eval slice** (e.g. 50–200 rows): high-risk (changing mole, ulcer, rapid growth), common benign patterns, product/routine, vague titles — **`golden_stratified_slice_v1.json`** (~120 rows) + **`golden_phase1_manifest.json`**
- [ ] **P1.4** **Clinician spot-check** a sample of `ground_truth` for clinical safety and tone (or mark as “editorial target” only) — **process in** [`Knowledge/eval/CLINICIAN_SPOT_CHECK.md`](../Knowledge/eval/CLINICIAN_SPOT_CHECK.md) *(manual sign-off)*
- [x] **P1.5** Import **gap reports** (`accuracy_gap_report`, `coverage_gap_report`, `synonym_gap_report`) as **regression baselines** — track specialty mismatch rate, synonym lift, cluster misses — **`Knowledge/eval/baselines/*.json`** + [`baselines/README.md`](../Knowledge/eval/baselines/README.md)

---

## Phase 2 — Triage (critical path)

Triage **before** heavy retrieval determines trust.

- [x] **P2.1** Specify **inputs**: raw user text, optional structured intake (OPQRST-like slots), optional image caption (if vision path exists) — [`PHASE_2_TRIAGE.md`](../docs/architecture/derm-patient-qa/PHASE_2_TRIAGE.md) + `classifyDermPatientQA` in `middleware-platform/services/derm-patient-qa-triage.js`
- [x] **P2.2** Implement **risk + intent classifier** (start with rules + keywords from `Knowledge/rules/triage-rules.json`, then LLM assist if needed):
  - [x] Map outputs to the Phase 0 taxonomy
  - [x] **Short-circuit** urgent path: minimal retrieval, strong escalation language, no long differential
- [x] **P2.3** Wire triage output to **retrieval policy** (what index, top_k, specialty filter, whether to ask **one** clarifying question)
- [x] **P2.4** Ensure consistency with existing **scheduling / red-flag gates** (`checkBeforeScheduling`, symptom triage services) — no contradictory “book” vs “urgent”
- [x] **P2.5** Add **logging**: intent, risk bucket, triage rationale (for eval and incident review)

---

## Phase 3 — Retrieval and corpus

Today’s default RAG path is **code-oriented** (ICD/CPT merge). Patient answers need **passages** (or a parallel education index).

- [x] **P3.1** **Corpus strategy**: curated **derm-first** chunks (guidelines, internal briefs, approved sources); version and ownership — [`Knowledge/corpus/derm-education/manifest.json`](../Knowledge/corpus/derm-education/manifest.json) + [`PHASE_3_CORPUS_AND_INDEX.md`](../docs/architecture/derm-patient-qa/PHASE_3_CORPUS_AND_INDEX.md)
- [x] **P3.2** **Index contract**: extend Colab **`/retrieve`** (or add **`/retrieve_passages`**) to return **text chunks + source ids + specialty**, not only codes — *or* stand up a **separate** education retrieval service — contract in Phase 3 doc; middleware calls **`POST /retrieve_passages`**
- [x] **P3.3** **Hybrid retrieval**: dense (Pinecone) + keyword/BM25 + **filters** (pediatric, pregnancy if applicable, derm specialty) — request payload `hybrid` + `filters`; single-query backends merge in `patient-education-client.js`
- [x] **P3.4** **Query construction**:
  - [x] Lay ↔ clinical expansion (reuse ideas from `synonym_gap_report` — expansion lifts scores) — [`Knowledge/rules/derm-lay-clinical-expansions.json`](../Knowledge/rules/derm-lay-clinical-expansions.json) + `patient-education-query.js`
  - [x] Optional **HyDE** only where it helps (see `triage-rag-service-v2` patterns); measure harm on vague queries — gated in `patient-education-query.js` (`shouldSkipHyde`, `DERM_EDU_HYDE=0` to disable)
- [x] **P3.5** **Reranking**: cross-encoder or derm-tuned reranker on query–passage pairs (phase 2 of retrieval) — lexical overlap rerank `patient-education-passage-rerank.js` (optional cross-encoder later)
- [x] **P3.6** **Middleware integration**:
  - [x] New client module (e.g. `layer2-rag/patient-education-client.js`) calling RAG with **passage** response shape
  - [x] Env: `RAG_EDUCATION_URL` vs overloading `RAG_API_URL` — document in `ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`

---

## Phase 4 — Answer generation and safety

- [x] **P4.1** **Prompt / template library** by intent: urgent vs education vs routine; fixed sections (what evidence supports, limits, next step) — [`Knowledge/prompts/derm-patient-qa-templates.json`](../Knowledge/prompts/derm-patient-qa-templates.json) + `composeFromParts` / `composeDermPatientQAAnswer` in `middleware-platform/services/derm-patient-qa-answer.js`
- [x] **P4.2** **Grounding rules**: if retrieved passages don’t match question (see golden examples with **evidence mismatch**), **abstain** or ask one discriminating question — do not fill with unrelated acne text — `middleware-platform/services/derm-patient-qa-grounding.js` (`DERM_QA_GROUNDING_MIN_SCORE`)
- [x] **P4.3** **Citation** of chunk ids / source labels in UI or debug mode — `derm-patient-qa-citations.js`; compose returns `citations` / `citations_for_ui`; `debug: true` expands previews
- [x] **P4.4** **Image path** (if applicable): explicit “cannot diagnose from image alone”; align caption pipeline with retrieval query — `derm-patient-qa-image.js` + `buildRetrievalFacingText` used in compose/retrieval
- [x] **P4.5** **Content policy**: block cosmetic SEO spam in corpus; boost guideline-tagged chunks in rerank — [`Knowledge/rules/derm-corpus-content-policy.json`](../Knowledge/rules/derm-corpus-content-policy.json) + `rerankPassagesWithContentPolicy` in `patient-education-passage-rerank.js`

**API:** `POST /api/patient/derm-qa/compose` — **Spec:** [`docs/architecture/derm-patient-qa/PHASE_4_ANSWER_AND_SAFETY.md`](../docs/architecture/derm-patient-qa/PHASE_4_ANSWER_AND_SAFETY.md)

---

## Phase 5 — Product / API wiring

- [x] **P5.1** Choose **surface**: new route e.g. `POST /api/patient/derm-qa` **or** Step10 graph node **after** triage (see `step10-graph.js`, `invokeStep10`) — **`POST /api/patient/derm-qa`** + **`invokeStep10.inputs.derm_patient_qa`** short-circuit (see [`PHASE_5_PRODUCT_WIRING.md`](../docs/architecture/derm-patient-qa/PHASE_5_PRODUCT_WIRING.md))
- [x] **P5.2** **Auth / session**: same patient session patterns as other patient APIs; rate limits — `apiLimiter`, `requirePatientSession`, `requireCsrfForCookieAuth` on `/api/patient/derm-qa`
- [x] **P5.3** **Kelly / voice** (optional): tool that calls the same pipeline so voice and chat share behavior — **`run_derm_patient_qa`** when `DERM_EDUCATION_PIPELINE_ENABLED=true` (Kelly tool list + `kelly-tool-executor`)
- [x] **P5.4** **Feature flag**: `DERM_EDUCATION_PIPELINE_ENABLED` (or similar) for safe rollout — gates HTTP route, Step10 branch, Kelly tool registration; `DERM_QA_SKIP_LLM` for compose-only runs

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

*Last updated: Phase 0 spec in `docs/architecture/derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md`; Phase 8 UI/UX; RAGAS diagnosis; Reddit/golden eval.*
