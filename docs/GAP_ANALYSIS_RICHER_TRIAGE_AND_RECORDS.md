# Gap Analysis: Richer Triage & Patient Records Q&A

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
- [ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md](./architecture/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md) — RAG integration
- [TRIAGE_CLINICAL_GRADE_ROADMAP.md](../todos/TRIAGE_CLINICAL_GRADE_ROADMAP.md) — actionable todos for 6 stages (history, RAG, differentials, ICD/CPT, matching, SOAP)
