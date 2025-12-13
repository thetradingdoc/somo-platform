# Knowledge Base - Master Documentation

## Architecture Overview

### Current State
- **Location**: `/Knowledge/` directory
- **Files**: `icd10_reference.json` (1,357 codes), `rules/simple-coding-rules.json` (30+ rules)
- **Services**: `knowledge-service.js`, `medical-coding-service.js`, `coding-orchestrator.js`
- **Problem**: Knowledge base is **completely disconnected** from voice agent. Only used for post-call medical coding, not real-time triage or text extraction.

### Desired State
- Voice agent can extract medical text from patient descriptions
- Voice agent can assess triage urgency (EMERGENT/URGENT/ROUTINE)
- Voice agent can detect red flags and route appropriately
- Knowledge base accessible during voice calls (not just post-call)

### Architecture Flow
```
Voice Agent → Function Call → retell-websocket.js → Service → knowledge-service.js → Knowledge Base Files
```

---

## Implementation Todo List

### PHASE 1: Knowledge Base Files (Foundation)

#### 1.1 Create Triage Rules
- [ ] **File**: `/Knowledge/rules/triage-rules.json`
- [ ] Define 4 urgency levels: EMERGENT, URGENT, ROUTINE, NON_URGENT
- [ ] Add 20-30 red flag symptom scenarios
- [ ] Add vital sign thresholds (fever, BP) with age-specific rules
- [ ] Add action recommendations for each urgency level
- [ ] Link to ICD-10 codes for each scenario

#### 1.2 Create Medical Entities Database
- [ ] **File**: `/Knowledge/ontology/medical-entities.json`
- [ ] Create symptom synonym mappings
- [ ] Define severity indicators (mild, moderate, severe patterns)
- [ ] Create temporal patterns (duration, onset, frequency)
- [ ] Add body location mappings
- [ ] Define vital sign extraction patterns

#### 1.3 Create Medical Abbreviations
- [ ] **File**: `/Knowledge/ontology/medical-abbreviations.json`
- [ ] Compile 50+ common medical abbreviations (SOB, HA, CP, URI, UTI, HTN, DM, etc.)
- [ ] Map each abbreviation to full term

#### 1.4 Create Extraction Patterns
- [ ] **File**: `/Knowledge/rules/extraction-patterns.json`
- [ ] Define regex patterns for symptom extraction
- [ ] Create patterns for vital sign extraction
- [ ] Define temporal information patterns
- [ ] Create severity detection patterns

---

### PHASE 2: Service Layer Enhancement

#### 2.1 Enhance Knowledge Service
- [ ] **File**: `middleware-platform/services/knowledge-service.js`
- [ ] Add `loadTriageRules()`, `loadMedicalEntities()`, `loadMedicalAbbreviations()`, `loadExtractionPatterns()`
- [ ] Add `expandMedicalAbbreviations(text)` function
- [ ] Add `normalizeMedicalTerms(text)` function
- [ ] Add `getTriageRules()`, `getMedicalEntities()`, `getExtractionPatterns()` functions
- [ ] Update `module.exports` to include all new functions

#### 2.2 Create Medical Text Extraction Service
- [ ] **File**: `middleware-platform/services/medical-text-extraction-service.js` (NEW)
- [ ] Create class `MedicalTextExtractionService`
- [ ] Implement `extractStructuredData(text)` - Extract symptoms, vital signs, temporal info, severity
- [ ] Implement `extractSymptoms(text)`, `extractVitalSigns(text)`, `extractTemporalInfo(text)`, `detectSeverity(text)`
- [ ] Use knowledge-service for abbreviation expansion and normalization
- [ ] Use extraction-patterns.json for pattern matching

#### 2.3 Create Triage Service
- [ ] **File**: `middleware-platform/services/triage-service.js` (NEW)
- [ ] Create class `TriageService`
- [ ] Implement `assessUrgency(symptoms, vitalSigns, patientContext)` - Check red flags, assess thresholds, return urgency
- [ ] Implement `detectRedFlags(symptoms, text)` - Detect red flag symptoms
- [ ] Implement `suggestCareLevel(urgency, symptoms)` - Suggest ER/Urgent Care/Primary Care
- [ ] Use knowledge-service to get triage rules
- [ ] Use medical-text-extraction-service for symptom extraction

---

### PHASE 3: Voice Agent Integration

#### 3.1 Add Functions to Retell Functions Definition
- [ ] **File**: `middleware-platform/retell-functions/retell-functions.json`
- [ ] Add `extract_medical_text` function definition
- [ ] Add `assess_triage` function definition
- [ ] Add `detect_red_flags` function definition

#### 3.2 Add Function Handlers
- [ ] **File**: `middleware-platform/webhooks/retell-websocket.js`
- [ ] Add `case 'extract_medical_text':` in `handleFunctionCall()` switch statement
- [ ] Add `case 'assess_triage':` in `handleFunctionCall()` switch statement
- [ ] Add `case 'detect_red_flags':` in `handleFunctionCall()` switch statement
- [ ] Implement `handleExtractMedicalText(callId, functionArgs)` function
- [ ] Implement `handleAssessTriage(callId, functionArgs)` function
- [ ] Implement `handleDetectRedFlags(callId, functionArgs)` function

#### 3.3 Update Voice Agent Prompt
- [ ] **File**: `docs/voice-agent/shop-voice-agent-prompt.md` OR create `medical-voice-agent-prompt.md`
- [ ] Add section: "Medical Text Extraction & Triage"
- [ ] Define agent's role: Extract information, assess urgency, route appropriately
- [ ] Add instructions for when to call new functions
- [ ] Add examples of proper usage
- [ ] Emphasize: "You do NOT diagnose, you extract and route"

---

### PHASE 4: Testing

#### 4.1 Unit Tests
- [ ] **File**: `middleware-platform/tests/test-triage-service.js` (NEW)
- [ ] Test red flag detection, urgency assessment, age-specific rules, care level suggestions

- [ ] **File**: `middleware-platform/tests/test-medical-text-extraction.js` (NEW)
- [ ] Test symptom extraction, vital sign extraction, temporal extraction, abbreviation expansion, severity detection

#### 4.2 Integration Tests
- [ ] **File**: `middleware-platform/tests/test-voice-agent-triage.js` (NEW)
- [ ] Test end-to-end: Voice call → Function call → Triage assessment → Response

---

## Critical Path

1. Create `/Knowledge/rules/triage-rules.json`
2. Create `/Knowledge/ontology/medical-entities.json`
3. Create `/Knowledge/ontology/medical-abbreviations.json`
4. Enhance `knowledge-service.js`
5. Create `medical-text-extraction-service.js`
6. Create `triage-service.js`
7. Add functions to `retell-functions.json`
8. Add handlers in `retell-websocket.js`
9. Update voice agent prompt

---

## Success Criteria

- [ ] Voice agent can extract medical text from patient descriptions
- [ ] Voice agent can assess triage urgency (EMERGENT/URGENT/ROUTINE)
- [ ] Voice agent can detect red flags and route appropriately
- [ ] Knowledge base is accessible during voice calls
- [ ] Triage accuracy >90%
- [ ] Text extraction completeness >85%
- [ ] Response time <2 seconds

---

## Estimated Timeline

- **Phase 1** (Knowledge Base): 2-3 days
- **Phase 2** (Services): 3-4 days
- **Phase 3** (Integration): 2-3 days
- **Phase 4** (Testing): 2-3 days

**Total**: ~10-14 days

