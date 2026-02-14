# AI Agent Financial Layer Integration – Todo List

**Source:** Financial Layer Architecture Review  
**Goal:** Close the gap between backend capabilities and voice agent usage  
**Estimated:** ~2 weeks focused work

---

## 🔥 Critical – Week 1

### 1. Knowledge Files

- [x] **Create `Knowledge/rules/triage-rules.json`**
  - Define 10–15 emergent scenarios (acute MI, stroke/FAST, meningitis, seizure, anaphylaxis, suicide)
  - Define urgent scenarios (high fever, fracture, severe pain)
  - Include symptom combinations, age ranges, vitals thresholds, actions (call_911, same_day, routine)
  - Include ICD-10 codes and rationale per rule

- [x] **Create `Knowledge/ontology/medical-abbreviations.json`**
  - SOB, HA, CP, N/V, URI, UTI, HTN, DM, T2DM, GERD, COPD, etc. (50+ entries)

- [x] **Create `Knowledge/ontology/medical-entities.json`** (optional for Week 1)
  - Symptom synonyms, severity indicators, temporal patterns, body locations

- [x] **Create `Knowledge/ontology/extraction-patterns.json`** (optional for Week 1)
  - Regex for symptoms (pain in X, fever, nausea, etc.)
  - Regex for vitals (temperature °F, BP mmHg, heart rate)
  - Temporal patterns (duration, onset, frequency)

### 2. Voice Agent Prompt

- [x] **Update or create `docs/voice-agent/medical-voice-agent-prompt.md`**
  - Add "Medical Coding Workflow" section: EXTRACT → TRIAGE → CODE → PRICE → VALIDATE
  - Add WHEN to search codes (when patient describes symptoms)
  - Add HOW to interpret results (patient-friendly language)
  - Add CRITICAL SAFETY RULES (never delay emergency care, always assess urgency for symptoms)
  - Add examples (diabetes checkup → E11.9, 99213, copay quote)

- [x] **Update Retell agent prompt** (configure-retell.js)
  - Append `docs/voice-agent/medical-voice-agent-prompt.md` to Kelly/system prompt
  - Load Kelly from `docs/voice-agent/prompts/` or `docs/voice-agent/`

### 3. Wire Symptom → Code Search

- [x] **Add symptom-triggered code search in `retell-websocket.js`** (via `suggest_codes_from_symptoms`)
  - On patient utterance with symptoms: auto-search ICD-10 via `knowledgeService.searchIcd10Codes()` or `getCodeCandidates()`
  - Append proposed codes to `voice_conversation_memory` as `extracted_entities`
  - Return candidates to agent for use in response (or new function `suggest_codes_from_symptoms`)

- [x] **Add Retell function `suggest_codes_from_symptoms`**
  - `retell-functions.json`: define function with `symptoms` or `clinical_text` param
  - Handler: call `knowledgeService.getCodeCandidates()`, return top 3–5 with patient-friendly descriptions

### 4. Medical Abbreviation Expansion

- [x] **Add to `knowledge-service.js`**
  - Load `medical-abbreviations.json` (with fallback if missing)
  - Export `expandMedicalAbbreviations(text)`
  - Use in `getCodeCandidates()`, `extractKeywords()`, or before search

---

## 🟠 High Priority – Week 2

### 5. Triage Service Enhancement

- [x] **Update `triage-service.js`**
  - Load `triage-rules.json` (structured rules)
  - Replace or augment hardcoded `detectRedFlags()` with rule-based lookup
  - Add age-specific rules (pediatric vs adult)
  - Add vital sign thresholds when available

### 6. Diagnosis Code Mapper Enhancement

- [x] **Expand `diagnosis-code-mapper.js`**
  - Add category-based mapping (E11 → 99213/99214/83036, I10 → 99213/93000, etc.)
  - Add `getCPTCodesForDiagnosisCategory(icd10Code)` using first 3 chars
  - Replace or augment the current 2-code proof-of-concept

### 7. Severity Detection

- [x] **Create `Knowledge/ontology/severity-indicators.json`**
  - Pain scale: mild (1–3), moderate (4–6), severe (7–10)
  - Temporal: acute, subacute, chronic

- [x] **Add severity detection to `knowledge-service.js` or new `medical-text-extraction-service.js`**

### 8. Symptom Extraction Service

- [x] **Create `services/medical-text-extraction-service.js`**
  - `extractStructuredData(text)` → { symptoms, vitals, severity, temporal }
  - `extractSymptoms(text)` – pattern matching + medical entities
  - `extractVitalSigns(text)` – temp, BP, heart rate
  - `extractTemporalInfo(text)` – duration, onset, frequency
  - Use `knowledgeService.expandMedicalAbbreviations()` first

### 9. Wire Pricing Quotes

- [x] **Ensure voice agent uses `get_code_pricing` when suggesting codes**
  - Update prompt: "After suggesting codes, use `get_code_pricing` if patient asks about cost"
  - Test: patient says "how much for a checkup" → agent calls `get_code_pricing` → quotes copay

### 10. Code Validation Before Suggesting

- [x] **Update voice flow**
  - Before presenting codes to patient, agent calls `validate_code_pair` for ICD-10 + CPT pairs
  - Prompt: "Always validate code pairs before finalizing suggestions"

---

## 🟡 Medium Priority – Month 2

### 11. Knowledge Service Enhancements

- [x] **In `knowledge-service.js`**
  - Wire `loadTriageRules()`, `loadMedicalEntities()`, `loadExtractionPatterns()`
  - Add `normalizeMedicalTerms(text)` if medical-entities supports it

### 12. Retell Function Additions

- [x] **Add `extract_medical_text`** (if extraction service exists)
  - Input: patient utterance
  - Output: structured { symptoms, vitals, severity }

### 13. PDF Coding Service Improvements

- [x] **In `pdf-coding-service.js`**
  - Replace hardcoded CPT pricing with `FeeScheduleService` / `getAllowedAmount()` when `payerId` in options
  - HCPCS pricing: not yet added (lower priority)

### 14. Voice Agent Test Suite

- [x] **Create `tests/medical-coding/voice-agent-test-cases.json`**
  - Emergency scenarios (chest pain, stroke) → expect 911/ER
  - Routine (diabetes checkup) → expect code suggestion
  - Extraction (symptoms, vitals)

- [x] **Add `evaluate-voice-agent.js`**
  - Simulate voice flows with symptom extraction, triage, code suggestion

---

## 🟢 Low Priority – Month 3+

### 15. Semantic Search (Optional)

- [ ] Set `OPENAI_API_KEY` and run `populate-code-embeddings.js`
- [ ] Enable `useSemantic: true` in `getCodeCandidates()` where beneficial

### 16. Patient-Friendly EOB Explanations

- [ ] Add endpoint or helper to translate EOB into plain language for voice agent

### 17. Multi-Model Routing

- [ ] Defer per MEDICAL_CODING_AGENT_TODO – only if evaluation shows accuracy gaps

---

## Summary Checklist

| Category | Tasks | Status |
|----------|-------|--------|
| Knowledge files | 4 | ✅ |
| Voice agent prompt | 2 | ✅ |
| Symptom → code wiring | 2 | ✅ |
| Abbreviation expansion | 1 | ✅ |
| Triage enhancement | 1 | ✅ |
| Diagnosis mapper | 1 | ✅ |
| Severity + extraction | 3 | ✅ |
| Pricing + validation | 2 | ✅ |
| Knowledge service | 1 | ✅ |
| PDF pricing fix | 1 | ✅ |
| Voice test suite | 2 | ✅ |
| Optional (semantic, EOB) | 2 | ⬜ |

---

## Files to Create

| File | Purpose |
|------|---------|
| `Knowledge/rules/triage-rules.json` | Structured triage rules |
| `Knowledge/ontology/medical-abbreviations.json` | Abbreviation → full term |
| `Knowledge/ontology/medical-entities.json` | Symptoms, synonyms, severity |
| `Knowledge/ontology/extraction-patterns.json` | Regex for symptoms/vitals |
| `Knowledge/ontology/severity-indicators.json` | Pain scale, temporal |
| `services/medical-text-extraction-service.js` | Extract structured data from text |
| `docs/voice-agent/medical-voice-agent-prompt.md` | Medical coding workflow for agent |
| `tests/medical-coding/voice-agent-test-cases.json` | Voice flow test cases |

## Files to Modify

| File | Changes |
|------|---------|
| `knowledge-service.js` | Load abbreviations, add `expandMedicalAbbreviations()` |
| `triage-service.js` | Load triage-rules.json, rule-based triage |
| `diagnosis-code-mapper.js` | Category-based mapping, expand coverage |
| `retell-websocket.js` | Symptom → code search wiring, optional new handler |
| `retell-functions.json` | Optional `suggest_codes_from_symptoms` |
| `pdf-coding-service.js` | Use FeeScheduleService for CPT pricing |
| `configure-retell.js` | Update prompt with medical workflow (if prompt stored here) |

---

*Last updated: February 2026*
