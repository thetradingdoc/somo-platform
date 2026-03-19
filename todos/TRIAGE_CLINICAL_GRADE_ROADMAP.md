# Triage Clinical-Grade Roadmap

**Status:** 57 todos across 6 stages + Patient Document Flow (35 original + 22 missing from v3.2/gap-map audit)  
**Source:** History taking, RAG quality, ICD/billing, matching, session storage, SOAP, patient records Q&A  
**Code reviewed:** `triage-rag-service.js`, `kelly-tool-executor.js`, `knowledge-service.js`, `specialist-resolver-service.js`, `database.js`, migrations, Kelly prompt

**Top 3 critical (unblock everything downstream):** M-S3.C (`triage_complete` criteria), M-S2.C (rag_confidence gate), M-S4.A (block insurance until target_specialty)

---

## Current State vs Required State

| Stage | Current | Gap |
|-------|---------|-----|
| **1. History** | OPQRST only via `store_triage_opqrst`; generic Kelly prompt | No PMH, meds, allergies, FHx, SHx (CAGE), specialty-specific deep-dive |
| **2. RAG** | `knowledge-service.getCodeCandidates` (keyword + optional semantic) | No triage-rag-v2; no HyDE + Pinecone + cross-encoder; RAG drives specialty via ICD keywords, not differentials |
| **3. Differentials** | None | No `_generateDifferentials`; returns single specialty from keyword/ICD prefix |
| **4. ICD/CPT** | ICD_SPECIALTY_MAP (prefix→specialty); hardcoded 90834 | Need ICD from differential; need `getCptCodeForVisit({ specialty, isNewPatient, urgency })` |
| **5. Matching** | SpecialistResolverService wired; passes `patientTier`; language hardcoded `en`, state `null` | Need differentials before matching; pass `language` from session, `location` (state); multi-specialty when 2 differentials point to different specialties |
| **6. Session/SOAP** | `upsertTriageSession` on tool call only; SOAP in triage_rag_results | Per-turn upsert; SOAP to triage_sessions when triage_complete; surface in slot booking |

---

## Stage 1 — History Collection (Biggest Gap)

### 1.1 Schema: Add rich intake columns

| Todo | File | Action |
|------|------|--------|
| **W1-S1.1** | `migrations/011_triage_rich_intake.js` | Create migration: add to `triage_sessions` — `family_history`, `medications`, `prior_diagnoses`, `prior_workups`, `allergies`, `alcohol_use`, `alcohol_cage_score` (INTEGER), `smoking_status`, `phq2_score`, `gad2_score`, `safety_screen`, `substance_use`, `critical_unknowns`, `soap_note`, `detected_language` |
| **M-S1.A** | `migrations/011_triage_rich_intake.js` | `alcohol_cage_score` (integer) — separate from `alcohol_use` (text). Score ≥2 = screen positive; affects Hepatology routing and `combinedText` confidence |
| **M-S6.A** | `migrations/011_triage_rich_intake.js` | Add `soap_note TEXT` definitively in migration 011 alongside other columns — no conditional audit |
| **W1-S1.2** | `database.js` | Extend `upsertTriageSession` to accept new columns; extend `getTriageSession` to return them |

### 1.2 Extend store_triage_opqrst

| Todo | File | Action |
|------|------|--------|
| **W1-S1.3** | `kelly-agent-service.js` | Add params to `store_triage_opqrst` tool def: `family_history`, `medications`, `prior_diagnoses`, `prior_workups`, `allergies`, `alcohol_use`, `alcohol_cage_score`, `smoking_status`, `phq2_score`, `gad2_score`, `safety_screen` |
| **W1-S1.4** | `kelly-tool-executor.js` | Extend `_storeTriageOpqrst` to pass new fields to `db.upsertTriageSession` |
| **M-S1.B** | `utils/phq-gad-scorer.js` (new) | `_scorePHQ2(answers)`, `_scoreGAD2(answers)` — compute scores from Kelly's question answers; store in session |
| **M-S1.C** | `kelly-voice-agent-prompt.md` | Define `safety_screen` protocol: 2-question Columbia ("In the past month, have you wished you were dead? Have you had thoughts of killing yourself?") yes/no stored; positive → `safety_level: red` override regardless of RAG |
| **M-S1.E** | `retell-websocket.js` / `database.js` | Persist `detected_language` to session row on each turn — prevents language drift (gap18) |

### 1.3 Kelly prompt: Specialty-specific deep-dive

| Todo | File | Action |
|------|------|--------|
| **W1-S1.5** | `docs/voice-agent/prompts/kelly-voice-agent-prompt.md` | Add **HPI** (OPQRST — already collected, ensure stored). Add **PMH**: prior diagnoses, prior workups, surgeries. Add **Meds + Allergies**: non-negotiable; "Are you on any medications?" critical for differential (e.g. antipsychotic → medication-induced hyperprolactinemia). Add **FHx/SHx**: Cardiology → first-degree MI before 60; Oncology → FHx colon/breast/prostate; Psychiatry/Hepatology → CAGE-4 alcohol screen |
| **W1-S1.6** | `kelly-voice-agent-prompt.md` | Add second-pass prompts per specialty after RAG suggests one: **Hepatology/GI** — alcohol use, meds/supplements, prior liver tests; **Cardiology** — family heart disease, prior ECG/echo; **Psychiatry** — PHQ-2, GAD-2, safety screen |
| **W1-S1.7** | `kelly-voice-agent-prompt.md` | Instruct Kelly: after RAG suggests specialty, ask specialty-specific deep-dive questions, store via `store_triage_opqrst`, then call `run_triage_rag` again with full combined history |

### 1.4 get_triage_session returns rich intake

| Todo | File | Action |
|------|------|--------|
| **W1-S1.8** | `kelly-tool-executor.js` | Extend `_getTriageSession` to return `family_history`, `medications`, `prior_diagnoses`, `prior_workups`, `allergies`, `alcohol_use`, `alcohol_cage_score`, etc. from `getTriageSession` |

### 1.5 critical_unknowns write path

| Todo | File | Action |
|------|------|--------|
| **M-S1.D** | `triage-rag-service.js` / `kelly-tool-executor.js` | `run_triage_rag` returns `critical_unknowns` from differential generation; Kelly (1) receives in response, (2) stores via `upsertTriageSession`, (3) uses to drive follow-up questions |

---

## Stage 2 — RAG / Vector Search

### 2.1 Wire triage-rag-service-v2 (or upgrade current)

| Todo | File | Action |
|------|------|--------|
| **W2-S2.1** | `services/triage-rag-service-v2.js` (new or refactor) | Implement or adopt: `combinedText` → embed → HyDE blend → Pinecone top-K → cross-encoder rerank. Current `knowledge-service.getCodeCandidates` returns vocabulary hits, not clinical differentials |
| **M-S2.B** | `triage-rag-service-v2.js` | HyDE blend spec: 45/55 raw/hypothetical ratio + medical textbook passage system prompt from v3.2 |
| **W2-S2.2** | `kelly-tool-executor.js` | Point `_runTriageRAG` at v2 service when available; keep v1 as fallback |
| **W2-S2.3** | Config | Ensure `combinedText` = symptom + full history (OPQRST + PMH + FHx + meds) — not just symptom string |
| **M-S2.A** | `triage-rag-service.js` | Signal analysis pre-step before `_generateDifferentials`: if labs/upload present (verbal or file), compute key ratios (AST:ALT, NLR) and clusters; normalize input to LLM. Even without labs, normalize concatenated history |
| **M-S2.C** | `kelly-agent-service.js` / `kelly-tool-executor.js` | **Critical gate:** if `rag_confidence < 0.7`, block slots and return prompt: "Ask one more clarifying question, then call run_triage_rag again." Catches weak-signal PrimaryCare fallbacks |
| **M-S2.D** | `triage-rag-service.js` / `kelly-tool-executor.js` | Two-pass RAG: second call (after specialty deep-dive) upserts by session_id — update `target_specialty`, `differentials`, `icd_codes`, `soap_note` in place; do not create a second `triage_rag_results` row |

### 2.2 RAG vs specialty selection

| Todo | File | Action |
|------|------|--------|
| **W2-S2.4** | `triage-rag-service.js` | Use RAG chunks for context; do not let `getCodeCandidates` ICD hits drive specialty alone. Specialty comes from differential generation (Stage 3), not keyword/ICD prefix |

---

## Stage 3 — Differential Generation (Most Consequential)

### 3.1 Add _generateDifferentials

| Todo | File | Action |
|------|------|--------|
| **W2-S3.1** | `triage-rag-service.js` | Add `_generateDifferentials(RAGChunks, fullClinicalHistory)` — calls GPT-4o with v3.2-style prompt; returns top-3 differentials: `{ condition, icd10, coverage_pct, mechanism, supporting_evidence, evidence_against, discriminating_test, confidence_cap_reason }` |
| **W2-S3.2** | `triage-rag-service.js` | Add `DIFFERENTIAL_SPECIALTY_MAP`: NASH→Gastroenterology, Prolactinoma→Endocrinology, Alcoholic hepatitis→Gastroenterology, Major depressive disorder→Psychiatry, etc. Map primary differential → specialty |
| **M-S3.A** | `triage-rag-service.js` | **Minimum coverage spec:** Map must include ≥14 conditions: NASH, Alcoholic hepatitis, Autoimmune hepatitis → Gastroenterology; Prolactinoma, Hypothyroidism, Diabetes → Endocrinology; COPD, Asthma → Pulmonology; MI, Arrhythmia → Cardiology; MDD, GAD, PTSD → Psychiatry; Sepsis, TB, HIV → InfectiousDisease |
| **M-S3.B** | `triage-rag-service.js` | Confidence cap: if `alcohol_cage_score` null and differential includes Alcoholic hepatitis or NASH → cap confidence at "moderate", add "alcohol history" to `critical_unknowns`, prompt Kelly to ask CAGE before routing |
| **W2-S3.3** | `triage-rag-service.js` | When 2+ differentials point to different specialties, return both; Kelly surfaces choice to patient |
| **W2-S3.4** | `triage-rag-service.js` | Integrate differentials into `enrichFromSymptoms` return: `differentials`, `target_specialty` from primary, `secondary_specialties` from other differentials |
| **W2-S3.5** | `triage_rag_results` | Persist `differentials` JSON; add column if needed |
| **M-S3.C** | `kelly-tool-executor.js` / `triage-rag-service.js` | **Critical:** Define `triage_complete = true` criteria: all OPQRST stored + `run_triage_rag` returned ≥1 differential + `rag_confidence ≥ 0.7` (or second pass completed). Set flag when met; block `get_available_slots` until this |

---

## Stage 4 — ICD-10 / CPT Coding

### 4.1 ICD from differentials

| Todo | File | Action |
|------|------|--------|
| **W3-S4.1** | `triage-rag-service.js` | Primary ICD-10 = differential #1's `icd10` field. Stop using ICD prefix → specialty for billing |
| **W3-S4.2** | `kelly-tool-executor.js` | Pass resolved ICD from triage result to insurance/checkout flow |

### 4.2 CPT helper (replace hardcoded 90834)

| Todo | File | Action |
|------|------|--------|
| **W3-S4.3** | `utils/cpt-helper.js` (new) | `getCptCodeForVisit({ specialty, isNewPatient, urgency, isTelehealth })` — 99202–99205 for new; 99211–99215 for established; 90791/90834/90837 for Psychiatry; 93000/93306 for Cardiology procedural |
| **M-S4.B** | `utils/cpt-helper.js` | Definitive CPT table: cover all 9 specialties in DIFFERENTIAL_SPECIALTY_MAP. Urgency: `emergent` → 99285; `urgent` → 99204/99205; `routine` → 99203/99204 |
| **W3-S4.4** | `kelly-tool-executor.js` | Use `getCptCodeForVisit` instead of `firstCpt || '90834'` in `_collectInsurance` |
| **W3-S4.5** | `server.js` / appointment flow | Replace hardcoded 90834 where appointment-type mapping exists; use getCptCodeForVisit |
| **W3-S4.6** | `insurance-service.js` | Ensure eligibility check uses resolved CPT, not pre-triage default |
| **M-S4.A** | `kelly-tool-executor.js` | **Critical:** Block `_collectInsurance` until `target_specialty` known. If null, return: "I'll confirm your coverage once we understand your needs better." Prevents wrong CPT on pre-triage insurance check |

---

## Stage 5 — Specialist Matching

### 5.1 Require differentials before matching

| Todo | File | Action |
|------|------|--------|
| **W3-S5.1** | `kelly-tool-executor.js` | In `_getAvailableSlots`, assert `triageResult.differentials` exists (or at least `target_specialty` from differential) before calling resolver. If differentials not yet generated, block with message |
| **W3-S5.2** | `kelly-tool-executor.js` | Pass `specialty: triageResult.target_specialty` from differential, not from keyword guess |

### 5.2 Pass full resolver inputs

| Todo | File | Action |
|------|------|--------|
| **W3-S5.3** | `kelly-tool-executor.js` | Call `SpecialistResolverService.resolve` with: `specialty`, `language` from session (not hardcoded `en`), `location` (patient state), `urgency`, `priceTier` (or `patientTier`), `clinicId`, `date` |
| **W3-S5.4** | `retell-websocket.js` / session | Ensure `session.detected_language` and patient `state` are available to Kelly context |

### 5.3 Multi-specialty routing

| Todo | File | Action |
|------|------|--------|
| **W3-S5.5** | `kelly-tool-executor.js` | When primary + secondary differentials map to different specialties, call resolver twice; return both option sets; add `kelly_script` or structured response so Kelly can narrate: "Based on your symptoms you may need both a liver specialist and a hormone specialist..." |
| **M-S5.A** | `kelly-tool-executor.js` / `kelly-agent-service.js` | When `SpecialistResolverService` returns `kellyScript` (filter decay: "No Swahili-speaking cardiologist — our team can translate..."), inject into Kelly's next system message or tool response so LLM says it |
| **M-S5.B** | `server.js` | Call `SpecialistResolverService.cleanupCache()` on startup and via `setInterval` every 60 minutes (gap16) |
| **M-S5.C** | `migrations/` | DB unique constraint `(practitioner_id, start_time, status)` — practitioner-scoped to prevent double-booking when resolver assigns practitioner (gap17) |

---

## Stage 6 — Session + SOAP Storage

### 6.1 Per-turn upsert

| Todo | File | Action |
|------|------|--------|
| **W1-S6.1** | `kelly-agent-service.js` / prompt | Instruct Kelly: after each material clinical answer (OPQRST or rich intake), call `store_triage_opqrst` with updated fields — not only at end of OPQRST |
| **W1-S6.2** | `kelly-tool-executor.js` | Ensure `store_triage_opqrst` is idempotent for partial updates (upsert with COALESCE) |

### 6.2 SOAP on triage_complete

| Todo | File | Action |
|------|------|--------|
| **W4-S6.3** | `triage-rag-service.js` | SOAP already built in `_buildSoapNote`; persist to `triage_rag_results.soap_note` (done). Add: when `triage_complete = true`, also persist to `triage_sessions.soap_note` |
| **W4-S6.5** | Slot booking / appointment creation | Surface `soap_note` so specialist receives it at appointment creation (FHIR Composition or notes field) |
| **M-S6.B** | `triage-rag-service.js` | Upgrade `_buildSoapNote` to include rich intake in Subjective: `medications`, `family_history`, `prior_diagnoses`, `allergies`, `alcohol_cage_score` — not just OPQRST |

---

## Stage 7 — Patient Document Flow (New Section)

From implementation plan (Doc 5, Sections 5–6). Not in original roadmap.

| Todo | File | Action |
|------|------|--------|
| **M-Doc.1** | `server.js` / upload handler | Dual-write on triage upload: write to both `patient_documents` (patient-scoped, persistent) and `case_report_media` (session-scoped). Enables "ask about my records" retrieval |
| **M-Doc.2** | `services/patient-document-extraction.js` (new) | After upload, run vision/OCR extraction; store structured text in `patient_document_extracts` (or new table). Makes patient record queryable without re-running v3.2 |
| **M-Doc.3** | `server.js` / `kelly-agent-service.js` | `POST /api/patient/records/query` — Kelly intent ("explain my labs", "what did my last visit say") → load patient extracts → RAG with patient-scoped context → patient-friendly answer. Wire `query_patient_records` tool |

---

## Prioritized Build Order (Weeks)

| Week | Work | Why |
|------|------|-----|
| **W1** | Stage 6 upsert (S6.1–S6.2) + extend `store_triage_opqrst` (S1.1–S1.4, S1.8); M-S1.A/B/C/E, M-S6.A | Schema, tools, scorers, safety protocol, language persistence |
| **W1** | Stage 1 prompt + rich history fields (S1.5–S1.7) | Richer `combinedText`; single highest return per hour |
| **W2** | Stage 2: wire triage-rag-v2 (S2.1–S2.4); M-S2.A/B/C/D | Signal analysis, HyDE spec, confidence gate, two-pass upsert |
| **W2** | Stage 3: `_generateDifferentials` (S3.1–S3.5); M-S1.D, M-S3.A/B/C | Differentials, map spec, confidence cap, **triage_complete criteria** |
| **W3** | Stage 4: CPT helper (S4.1–S4.6); M-S4.A/B | Block insurance until specialty; full CPT table |
| **W3** | Stage 5: Resolver (S5.1–S5.5); M-S5.A/B/C | kellyScript injection, cleanupCache, practitioner constraint |
| **W3** | Stage 7: M-Doc.1, M-Doc.2 | Dual-write, extraction |
| **W4** | Stage 6: SOAP (S6.3–S6.5); M-S6.B | SOAP with rich intake |
| **W4** | Stage 7: M-Doc.3 | Patient records query API + Kelly tool |

---

## Quick Wins (Highest Return per Hour)

1. **Stage 1 — Extend Kelly prompt** with specialty-specific intake questions and add `medications` + `family_history` + `alcohol_use` to `store_triage_opqrst`. That alone makes `combinedText` a real clinical picture before v2 is wired.
2. **Per-turn upsert** — ensure Kelly calls `store_triage_opqrst` after each material answer.
3. **M-S3.C** — Define and implement `triage_complete = true` criteria; nothing downstream works correctly without it.
4. **M-S2.C** — Enforce `rag_confidence < 0.7` gate; only quality control before routing.
5. **M-S4.A** — Block `_collectInsurance` until `target_specialty`; fixes wrong CPT on every pre-triage insurance check.

---

## Files to Touch (Summary)

| File | Changes |
|------|---------|
| `migrations/011_triage_rich_intake.js` | New columns incl. alcohol_cage_score, soap_note, detected_language; practitioner constraint |
| `database.js` | upsertTriageSession, getTriageSession |
| `kelly-agent-service.js` | Tool defs, prompt, kellyScript injection |
| `kelly-tool-executor.js` | _storeTriageOpqrst, _getTriageSession, _getAvailableSlots, _collectInsurance (block until specialty) |
| `triage-rag-service.js` | _buildCombinedText, _buildSoapNote (rich intake), _generateDifferentials, DIFFERENTIAL_SPECIALTY_MAP, signal analysis, confidence cap |
| `utils/cpt-helper.js` | New: getCptCodeForVisit (full table) |
| `utils/phq-gad-scorer.js` | New: _scorePHQ2, _scoreGAD2 |
| `docs/voice-agent/prompts/kelly-voice-agent-prompt.md` | Specialty-specific deep-dive, safety_screen protocol |
| `server.js` | CPT flow, cleanupCache startup + interval, dual-write upload, records query route |
| `insurance-service.js` | Use resolved CPT |
| `retell-websocket.js` | Persist detected_language to session |
| `services/patient-document-extraction.js` | New: extraction on upload |

---

## References

- [GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md](../docs/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md)
- [PATIENT_BOOKING_AND_TRIAGE_GAPS.md](../docs/PATIENT_BOOKING_AND_TRIAGE_GAPS.md)
