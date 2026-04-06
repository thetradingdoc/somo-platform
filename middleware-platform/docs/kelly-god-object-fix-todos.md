# Kelly god-object fix — implementation todos

Action checklist for the **phase-aligned prompts** work (Skin & Care landing + full Kelly cleanup).  
**Full context, diagrams, and file map:** [kelly-phase-prompt-architecture.md](./kelly-phase-prompt-architecture.md).

---

## Problem (why we’re doing this)

- **Symptom:** Skin & Care / routine intake conversations pick up **clinical triage** tone (OPQRST loops, “annual visit,” “any symptoms?” when acne was already stated) and **re-ask** fields we already stored.
- **Cause:** `filterKellyToolsByPhase` already **restricts tools** per phase, but **`buildSystemPrompt`** is a **single large** instruction block for almost all non-commerce turns — the model **reads** every job (scheduling, billing, triage, intake) even when it **cannot** call those tools.
- **Landing gap:** `littlelab-landing` often **does not send** `kelly_flow`, so `routine_intake_active` may never flip and users stay in default triage behavior.

---

## What “done” looks like (guiding principle)

Match the **commerce** pattern for non-commerce phases:

**narrow phase-specific instructions + shared safety block + tools already pruned for that phase**

(Commerce already uses `buildCommerceCheckoutSystemPrompt` + `COMMERCE_CHECKOUT_TOOLS`; triage/intake should get the same *shape*, not the commerce tool list.)

---

## Rollback / flags

| Variable | Purpose |
|----------|---------|
| `KELLY_ORCHESTRATOR_PHASE=0` | Disables tool pruning + orchestrator prompt injection (existing). |
| `KELLY_PHASE_PROMPTS` | `1` or `true` → `ROUTINE_INTAKE` and `ROUTINE_FOLLOWUP` use `kelly-prompt-builder.js` (narrow slice + shared safety + orchestrator). Unset / `0` / `false` → full `_buildSystemPromptLegacy` for all phases. Documented in `.env.example`. |

---

## Skin & Care session meta contract (Option A) — **Task 1**

Single writer rule: **`intake_complete` and `skincare_post_intake` are set only together** (same code path) so they cannot drift. Canonical behaviour is in `services/kelly-orchestrator-phase.js` (file header) and `KellyToolExecutor._syncRoutineSkincareIntakeMeta` in `services/kelly-tool-executor.js`.

| Meta key | Set where / by whom | Cleared / overridden when | Read where |
|----------|---------------------|----------------------------|------------|
| `routine_intake_active` | Landing (`kelly_flow` / equivalent) and voice path when Skin & Care flow starts; see [retell-kelly-flow.md](./retell-kelly-flow.md). | **`resolveOrchestrationPhase`**: medical-escape fragments during intake or after follow-up → also sets `kelly_triage_reopen` and clears consumer path. **`return_to_triage` tool**: does not clear this key today; triage reopen drives phase. | **`resolveOrchestrationPhase`** (`routineIntakeHold`, `routineSkincareConsumerHold`, escalation blocks). |
| `intake_complete` | **Server only:** `KellyToolExecutor._syncRoutineSkincareIntakeMeta` when Skin & Care **hard gates** pass (same block as `skincare_post_intake`). | Not routinely cleared mid-session; new assessment flows may reset via future product logic. | **`resolveOrchestrationPhase`** (`routineIntakeHold` false when true); prompts reference orchestrator state. |
| `skincare_post_intake` | **Same function, immediately after** `intake_complete` in `_syncRoutineSkincareIntakeMeta`. | **`resolveOrchestrationPhase`**: post–intake medical escape → `'0'` with `routine_intake_active` cleared. **`return_to_triage`** in `kelly-tool-executor.js` → `'0'`. | **`resolveOrchestrationPhase`**: with `routine_intake_active` + `intake_complete`, selects **`ROUTINE_FOLLOWUP`** instead of falling through to **`TRIAGE_ACTIVE`** (session row + no RAG). |

**Phase outcome:** When all three metas are true (and billing / triage-reopen do not apply), orchestrator phase is **`ROUTINE_FOLLOWUP`** — consumer report/education, not clinical triage, until explicit escalation.

---

## Success criteria

- [x] Landing Skin & Care with `kelly_flow` set: **no** unsolicited “annual checkup with no symptoms” when the user already stated a **skin complaint** (guards + tests; spot-check landing in prod).
- [x] **No** repetitive OPQRST-style loops when stored fields already hold answers — **summary + gap hints injected** each turn when phase prompts are on (`formatRoutineIntakeSummaryFromTriageRow` + session meta gaps).
- [x] **ROUTINE_INTAKE** turns use **intake-sized** system text when `KELLY_PHASE_PROMPTS=1` — Jest ceiling in `kelly-prompt-builder.test.js`.
- [x] **One env flip** (`KELLY_PHASE_PROMPTS` off / `KELLY_ORCHESTRATOR_PHASE=0`) restores legacy monolith + unpruned tools behavior.

---

## Implementation checklist

Use as GitHub issues or project tasks. Check boxes as you merge.

**Coupling:** **A1** and **D2** land together in practice — once `kelly_flow` activates `ROUTINE_INTAKE`, missing **persistence + summary injection** shows up immediately as **re-asks**. Prefer shipping **A1** and **D2** in the same release train, or document accepted interim degradation.

### Phase A — Entry & activation

- [x] **A1.** Add `kelly_flow` (or `routine_intake_active`) to `sendLandingAssistantTurn` in `unified-dashboard/littlelab-landing/src/landingAssistantApi.js` for Skin & Care. (Default `kelly_flow: 'skincare'`; pass `kellyFlow: null` to omit.)
- [x] **A2.** Smoke-test **two-turn minimum**: (1) confirm `routine_intake_active` / meta after first turn; (2) second turn with a fact stated on turn 1 — verify the model still “knows” it once **D2** exists (or file a known gap if D2 is not shipped yet). **Automation:** `npm run smoke:landing-assistant` in `middleware-platform` (optional `DB_PATH` for SQLite meta assert).
- [x] **A3.** Document required values for Retell `dynamic_variables` (server already reads flow in `webhooks/retell-websocket.js`). **Doc:** [retell-kelly-flow.md](./retell-kelly-flow.md).
- [x] **A4 / Task 1.** **Option A meta contract:** who sets/clears/reads `routine_intake_active`, `intake_complete`, and `skincare_post_intake` (single-writer rule). Documented in **Skin & Care session meta contract** earlier in this file; code header in `services/kelly-orchestrator-phase.js` stays the implementation anchor.

### Phase S2 — Skin assessment product spec (before schema wiring)

- [x] **S2.1 (tasks 6–8).** Step 2 **four paths**, **minimum report contents**, **path → Step 1 field map**, and **hard/soft completion gates** (spec only): [skincare-assessment-product-spec.md](./skincare-assessment-product-spec.md).

### Phase S2.5 — Task 22 design lock + migration header

- [x] **S2.5.1 (tasks 9–10).** Locked **enums / JSON shapes / column list** in migration header + `up()` adding columns: [migrations/021_skincare_assessment_columns.js](../migrations/021_skincare_assessment_columns.js).

### Phase S3 — Skincare columns + persistence (tasks 11–13)

- [x] **S3.1.** `upsertTriageSession` patches all 11 assessment columns when present on the session object; `getTriageSession` parses `skin_concerns_json`, `triggers_json`, `prior_dermatologist_json`.
- [x] **S3.2.** `store_triage_opqrst` merges skincare fields when `routine_intake_active`; `store_triage_rich_intake` accepts the same keys when passed.

### Phase S4 + S4b — Completion + client signal (tasks 14–16)

- [x] **S4.1.** **`_syncRoutineSkincareIntakeMeta`**: five **hard gates** (`skin_type`, concerns array or **quality** text, `pregnancy_status`, `prior_dermatologist_json.seen` boolean, `functional_impact` 1–5) before `intake_complete` / `skincare_post_intake`; **soft gaps** in meta `skincare_intake_gaps_json`; **hard missing** list in `skincare_intake_hard_missing_json`.
- [x] **S4b.1.** `processTurn` success return and Groq fallback attach **`intake_complete`**, **`skincare_assessment_complete`**, **`report_ready`**, **`next_ui_step`**, **`orchestrator_phase`**, **`skincare_intake_gaps`**, **`skincare_intake_hard_missing`** when routine/assessment session.

### Phase B — Prompt dispatch

- [x] **B1.** Add `services/kelly-prompt-builder.js` with `buildSharedSafetyBlock`, `buildPhasePrompt`, `buildKellySystemPrompt`, `phasePromptsEnabled`.
- [x] **B2.** **Incremental:** `ROUTINE_INTAKE` slice lives in the builder; all other phases use `_buildSystemPromptLegacy` until F1–F4.
- [x] **B3.** `_runLLMLoop` calls `KellyPromptBuilder.buildKellySystemPrompt` when not `useCommerceTools` (commerce path unchanged).
- [x] **B4.** Orchestrator section is appended **after** the intake slice in `buildKellySystemPrompt`; intake copy defers red-flag tool routing to orchestrator to reduce overlap.
- [x] **B5.** Code references: `_buildSystemPromptLegacy` + builder only (docs still mention `buildSystemPrompt` historically).
- [x] **B6.** Shared safety = 911/988/channel/`return_to_triage` not in safety block; booking-phase `return_to_triage` rules stay in `buildOrchestrationPromptSection` only. Jest asserts safety text excludes `return_to_triage`.

### Phase C — `ROUTINE_INTAKE` slice (Skin & Care priority)

- [x] **C0.** **`mapToolDescriptionsForRoutineIntake`** in `kelly-orchestrator-phase.js` replaces descriptions for tools exposed in `ROUTINE_INTAKE` (incl. `get_triage_session`, `store_triage_opqrst`, `return_to_triage`, `request_document_upload`, `run_derm_patient_qa`). Broader **F1–F4** tool pass still TODO.
- [x] **C1.** Intake slice + persistence section in `kelly-prompt-builder.js` (annual-visit forbidden when concern on file; systemic “other symptoms”; specialist routing).
- [x] **C2.** Jest guard: routine slice length &lt; 6000 chars (`kelly-prompt-builder.test.js`).

### Phase D — Persistence & summary injection

- [x] **D1.** Field mapping documented in [retell-kelly-flow.md](./retell-kelly-flow.md) (`quality`, `onset`, `associated_sx`, optional `medications`).
- [x] **D2.** **`get_triage_session`** + **`store_triage_opqrst`** on `ROUTINE_INTAKE` / **`ROUTINE_FOLLOWUP`** allow list; **`formatRoutineIntakeSummaryFromTriageRow`** injected in `_runLLMLoop` for both phases when `KELLY_PHASE_PROMPTS` applies. Summary includes structured assessment columns, consumer labels for severity/timing/radiation, **photos/uploads** (`media_requested`, `media_received`, `media_ids`), and optional **`Still needed (server)`** / **`Nice to clarify`** lines from **`skincare_intake_hard_missing_json`** / **`skincare_intake_gaps_json`** (parsed in `kelly-agent-service.js` when building context).
- [x] **D3.** **`KellyToolExecutor._syncRoutineSkincareIntakeMeta`** sets **`intake_complete`** / **`skincare_post_intake`** meta + **`intake_complete_at`** when hard gates pass; gap metas `skincare_intake_gaps_json` / `skincare_intake_hard_missing_json`. Next-phase note in [retell-kelly-flow.md](./retell-kelly-flow.md).

### Phase D2b — Intake question order & tool copy (consumer)

- [x] **D2b.1.** `buildRoutineIntakePhasePrompt`: numbered **hard vs soft** collection order; plain-language severity/timing/radiation; persistence ties to summary “Still needed” / “Nice to clarify.”
- [x] **D2b.2.** `buildRoutineFollowupPhasePrompt`: optional soft-gap follow-up without rigid questionnaire framing.
- [x] **D2b.3.** **`ROUTINE_INTAKE_TOOL_DESCRIPTION_OVERRIDES`** in `kelly-orchestrator-phase.js`: expanded **`get_triage_session`** / **`store_triage_opqrst`** copy (field mapping, forbid “OPQRST” patient-facing wording, no triage-steering).

### Phase E — Code guards

- [x] **E1.** If triage/intake row has non-empty concern/onset, **block** `routine_no_symptoms` / routine-booking framing for that turn (`kelly-agent-service.js` / `kelly-tool-executor.js` — grep `routine_no_symptoms`).
- [x] **E2.** Regression test or script: acne + “no symptoms” → **no** annual-checkup script (`__tests__/routine-no-symptoms-guard.test.js`).

### Phase F — Other phases (full god-object removal)

- [x] **F1.** Triage slice(s): `TRIAGE_DISCOVERY` / `TRIAGE_ACTIVE`.
- [x] **F2.** `BOOKING` slice.
- [x] **F3.** `APPOINTMENT_CHECKOUT` slice (align with existing payment copy).
- [x] **F4.** `BILLING` slice.

### Phase G — Tests & CI

- [x] **G0.** Phase-validation + builder tests green in CI (`kelly-phase-validation.test.js` assertion updated for routine-intake tool text that **mentions** `run_triage_rag` only to **forbid** it).
- [x] **G1.** **`kelly-prompt-builder.test.js`**, **`kelly-phase-validation.test.js`**, **`clinical-recommendation-policy.test.js`**, **`skincare-intake-gates.test.js`**, **`routine-no-symptoms-guard.test.js`**, and **`kelly-skincare-assessment.test.js`** cover allowlists, resolver, orchestration slice, hard/soft gates, summary lines, negation/escalation, and policy fallbacks where deterministic.
- [x] **G2.** Routine slice char ceiling (`kelly-prompt-builder.test.js` C2); optional broader per-phase ceilings still incremental.
- [x] **G3.** **Opt-in** live LLM golden: `RUN_KELLY_GOLDEN=1` → `__tests__/kelly-skincare-assessment.test.js` Block 10 (Amara-style Skin & Care transcript); not run in default `npm test`.

### Phase H — Docs & handoff

- [x] **H1.** [kelly-phase-prompt-architecture.md](./kelly-phase-prompt-architecture.md) and this file updated for env vars, test map, `ROUTINE_FOLLOWUP`, summary/gaps, clinical fallback, and prompt-vs-server nuance (**§ Known nuance** below).
- [x] **H2.** `KELLY_PHASE_PROMPTS` + `KELLY_ORCHESTRATOR_PHASE` notes in `middleware-platform/.env.example`.

---

## Known nuance — prompt “hard gates” vs server completion

- **Server (`_skincareHardGateMissingList`):** exactly **five** fields before `intake_complete` / `skincare_post_intake`: `skin_type`, concerns (`skin_concerns_json` or `quality`), `pregnancy_status`, `prior_dermatologist_json.seen` true/false, `functional_impact` 1–5.
- **Kelly intake prompt** also teaches collecting **onset** (and OPQRST-flavored consumer fields) in conversation order; **onset is not** in `_skincareHardGateMissingList`. Product may later align prompt wording or add onset to the server list — until then, treat “question order” as UX and the five fields as **completion**.

---

## Post-ship hardening (not checklist blockers)

- [x] **Clinical reply guard:** `services/clinical-recommendation-policy.js` — when regex guardrails replace the assistant reply, **`ROUTINE_INTAKE` / `ROUTINE_FOLLOWUP`** use **`FALLBACK_REPLY_ROUTINE_SKINCARE`** (no “what symptom or concern should we focus on next”). Wired in `KellyAgentService._runLLMLoop`.

---

## Totals (checklist items)

| Bucket | Count | IDs |
|--------|------:|-----|
| Implementation (A–H + S2–S4 + D2b) | **39** (core tracks **done** incl. G0–G3, H1, D2b) | A1–A4, S2–S4, B1–B6, C0–C2, D1–D3, D2b, E1–E2, F1–F4, G0–G3, H1–H2 |
| Success criteria (above) | **4** | tracked above |
| Optional follow-ups (below) | **2** | I2, I4 |

---

## Optional follow-ups (not required to close the core issue)

- [ ] **I2.** Logging: legacy vs dispatcher, phase, optional prompt size estimate for regressions.
- [ ] **I4.** Portal or other clients: same `kelly_flow` / intake entry if product requires parity beyond landing.

---

## Quick file map

| Area | Files |
|------|--------|
| Phases + tool filter + intake tool descriptions | `services/kelly-orchestrator-phase.js` |
| LLM loop + phase prompts + summary context | `services/kelly-agent-service.js` |
| Session meta, tools, hard/soft gate sync | `services/kelly-tool-executor.js` |
| Consumer clinical text fallback (skincare vs triage) | `services/clinical-recommendation-policy.js` |
| Phase-dispatched prompts + `formatRoutineIntakeSummaryFromTriageRow` | `services/kelly-prompt-builder.js` |
| Landing HTTP + triage wrapper | `server.js` |
| Voice | `webhooks/retell-websocket.js` |
| Landing client | `unified-dashboard/littlelab-landing/src/landingAssistantApi.js` |
| Skin assessment spec + Task 22 lock | [skincare-assessment-product-spec.md](./skincare-assessment-product-spec.md), `migrations/021_skincare_assessment_columns.js` |
| Deterministic Skin & Care regression suite | `__tests__/kelly-skincare-assessment.test.js` |

---

| Date | Note |
|------|------|
| 2026-04-03 | Extracted checklist + condensed problem/success for execution tracking. |
| 2026-04-03 | A2 two-turn smoke; A/D coupling note; B4/B6 orchestrator + safety de-dupe; C0 tool descriptions; G0 CI prerequisite; totals; I1 folded into C0. |
| 2026-04-03 | **Phase A shipped:** landing `kelly_flow`, `smoke:landing-assistant`, [retell-kelly-flow.md](./retell-kelly-flow.md). |
| 2026-04-03 | **Phase B shipped:** `kelly-prompt-builder.js`, `KELLY_PHASE_PROMPTS`, `__tests__/kelly-prompt-builder.test.js`. |
| 2026-04-03 | **Phases C–D:** routine intake tool overrides, `get_triage_session`/`store_triage_opqrst` in intake, summary injection, `intake_complete` auto. |
| 2026-04-03 | **Option A (orchestration):** `ROUTINE_FOLLOWUP` phase; `skincare_post_intake` co-set with `intake_complete` in **`_syncRoutineSkincareIntakeMeta`**; consumer hold avoids post-intake `TRIAGE_ACTIVE` drop. Meta contract in `kelly-orchestrator-phase.js` header. |
| 2026-04-03 | **Task 1 complete:** meta contract table + A4 in this doc; `KELLY_PHASE_PROMPTS` row notes `ROUTINE_FOLLOWUP`. |
| 2026-04-03 | **Phase S2 + S2.5:** [skincare-assessment-product-spec.md](./skincare-assessment-product-spec.md); `021_skincare_assessment_columns.js` (design header + columns). |
| 2026-04-03 | **S3–S4b:** DB patch + tool merge; hard gates + gap metas; `processTurn` assessment UI fields; summary + tool schema updates. |
| 2026-04-03 | **D2b + gaps in summary:** `formatRoutineIntakeSummaryFromTriageRow` extras; intake/follow-up question order; routine tool overrides; `kelly-skincare-assessment.test.js`; phase-validation test fix for RAG mention-in-override. |
| 2026-04-03 | **`FALLBACK_REPLY_ROUTINE_SKINCARE`** in clinical-recommendation-policy + `_runLLMLoop` phase branch (avoids triage fallback copy on Skin & Care). Docs: success criteria, G/H, nuance §, file map, totals. |
