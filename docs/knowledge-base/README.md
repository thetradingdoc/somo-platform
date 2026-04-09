# Knowledge Base - Master Documentation

**Last Updated:** April 9, 2026

## Architecture Overview

### Current State (April 6, 2026)
- **Location**: `/Knowledge/` directory
- **ICD-10**: `icd10_reference.json` (271 codes fallback), `icd10_codes` DB table (~72K from icd10cm_codes_2020.txt)
- **CPT**: `cpt_codes` DB table (1,299 codes from 2025 DHS Code List Addendum; run `node scripts/import-cpt-codes.js`)
- **HCPCS**: `hcpcs_codes` DB table (~9K from CMS HCPC2026)
- **Rules**: `rules/simple-coding-rules.json`, `rules/code-pair-validation.json`, `rules/triage-rules.json` (9 emergent, 4 urgent)
- **Ontology**: `ontology/medical-abbreviations.json` (75+), `ontology/medical-entities.json`, `ontology/extraction-patterns.json`, `ontology/severity-indicators.json`
- **Services**: `knowledge-service.js`, `triage-service.js`, `medical-text-extraction-service.js`, `medical-coding-service.js`, `coding-orchestrator.js`
- **Voice Agent**: ICD-10/CPT/HCPCS lookup, `suggest_codes_from_symptoms`, `extract_medical_text`, triage (`assess_urgency`), code-pair validation, pricing – all callable during voice calls

### Architecture Flow
```
Voice Agent → Function Call → retell-websocket.js → Service → knowledge-service.js → Knowledge Base Files
```

---

## Implementation Status (April 6, 2026)

### PHASE 1: Knowledge Base Files ✅

- [x] **triage-rules.json** – 9 emergent, 4 urgent scenarios
- [x] **medical-entities.json** – symptom synonyms, severity, temporal patterns
- [x] **medical-abbreviations.json** – 75+ abbreviations
- [x] **extraction-patterns.json** – symptoms, vitals, temporal, severity (in `ontology/`)
- [x] **severity-indicators.json** – pain scale, temporal

### PHASE 2: Service Layer ✅

- [x] **knowledge-service.js** – loadTriageRules, loadMedicalEntities, loadExtractionPatterns, expandMedicalAbbreviations, normalizeMedicalTerms
- [x] **medical-text-extraction-service.js** – extractStructuredData, extractSymptoms, extractVitalSigns, extractTemporalInfo, detectSeverity
- [x] **triage-service.js** – detectRedFlags (rule-based from triage-rules.json)

### PHASE 3: Voice Agent Integration ✅

- [x] **extract_medical_text** – Retell function + handler
- [x] **assess_urgency** – uses triage-service
- [x] **suggest_codes_from_symptoms** – getCodeCandidates + validated_pairs
- [x] **medical-voice-agent-prompt.md** – EXTRACT → TRIAGE → CODE → PRICE → VALIDATE

### PHASE 4: Testing

#### 4.1 Evaluation
- [x] **evaluate-accuracy.js** – 28 test cases (triage, coding, validation)
- [x] **evaluate-voice-agent.js** – 6 voice flow cases (emergency, routine, extraction)
- [x] **voice-agent-test-cases.json** – voice flow test cases

---

## Code Set Import Scripts

| Code Set | Script | Source | Notes |
|----------|--------|--------|-------|
| ICD-10 | `scripts/import-icd10-codes.js` | `Knowledge/ICD-10 Files/2020 Code Descriptions/icd10cm_codes_2020.txt` | ~72K codes |
| CPT | `scripts/import-cpt-codes.js` | `Knowledge/CPT/2025_DHS_Code_List_Addendum_11_26_2024.xlsx` | 1,299 codes; DHS addendum omits common E/M (99213, 99214) |
| HCPCS | `scripts/import-hcpcs-codes.js` | `Knowledge/HCPCS/hcpc2026_jan_anweb_01122026/HCPC2026_JAN_ANWEB_01122026.txt` | ~9K codes (fixed-width CMS format) |

**Semantic search (optional):** `scripts/populate-code-embeddings.js` – requires OPENAI_API_KEY. Embeds ICD-10/CPT/HCPCS for hybrid search via `getCodeCandidates(..., { useSemantic: true })`.

---

---

## Success Criteria (Achieved)

- [x] Voice agent can extract medical text from patient descriptions (`extract_medical_text`)
- [x] Voice agent can assess triage urgency (EMERGENT/URGENT/ROUTINE) (`assess_urgency`)
- [x] Voice agent can detect red flags and route appropriately (triage-rules.json)
- [x] Knowledge base is accessible during voice calls
- [x] Triage accuracy 100% (26/26); code retrieval 100% (16/16); voice eval 100% (6/6)
- [x] Response time P95 ~400ms

