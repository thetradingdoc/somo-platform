# Medical Coding Voice Agent – Detailed Todo List

Comprehensive implementation roadmap combining knowledge base improvements with architecture gaps from the voice agent review.

---

## Phase 0: Critical Path Fixes (Do First)

### 0.1 Fix Knowledge Base Paths
- [x] Update `knowledge-service.js` to load from `Knowledge/ICD-10 Files/icd10_reference.json` (or add symlink)
- [x] Verify primary path `Knowledge/ICD-10 Files/icd10_reference.json` exists
- [x] Add fallback if file moved (try both paths; fallback `Knowledge/icd10_reference.json` optional)

### 0.2 CPT Import
- [x] xlsx parser in `import-cpt-codes.js` (uses `xlsx` npm package)
- [x] Run CPT import: `node scripts/import-cpt-codes.js` → 1,299 codes from DHS addendum
- [x] Verify `cpt_codes` table populated
- [x] Document CPT source and version in `docs/knowledge-base/README.md` (DHS addendum; omits common E/M codes like 99213)

### 0.3 Wire Knowledge Base to Voice Agent
- [x] Add `search_icd10_codes` to `retell-functions.json`
- [x] Add `search_cpt_codes` to `retell-functions.json`
- [x] Add `search_hcpcs_codes`, `assess_urgency`, `validate_code_pair` to `retell-functions.json`
- [x] Implement handlers in `retell-websocket.js` calling `knowledge-service.js` / `triage-service.js`
- [x] ICD-10/CPT/HCPCS lookup callable **during** voice calls via function calls

---

## Phase 1: State Management (LangGraph-style Flow)

### 1.1 Define Coding Workflow States
- [x] Define states: `INTAKE` → `EXTRACTION` → `TRIAGE` → `CODING` → `VALIDATION` → `BILLING` (coding-state-service.js)
- [x] Document state transitions and triggers (see STATE_FLOW.md)
- [x] Add `current_stage` to call context (voice_call_states)

### 1.2 Database Schema for State
- [x] Create `voice_call_states` table (id, call_id, clinic_id, current_stage, state_data, updated_at)
- [x] Create `voice_conversation_memory` table (id, call_id, clinic_id, turn_number, role, content, extracted_entities)
- [x] Create `agent_state_snapshots` table (id, call_id, state_name, state_data)
- [x] Migration in `database.js`

### 1.3 Implement State Persistence
- [x] Persist state on each function call / turn (processCodingStateTurn in retell-websocket.js)
- [x] Add `getCallState`, `upsertCallState`, `appendConversationMemory`, `getConversationHistory` helpers
- [x] Conversation resumption (load last state on connect)
- [x] Cleanup policy: 30 days (`scripts/cleanup-voice-call-state.js`)

### 1.4 State Flow Implementation
- [x] State machine in `coding-state-service.js`
- [x] On each turn: load → compute next stage → persist → log
- [x] Log state transitions (console)

---

## Phase 2: Context Assembly & RAG

### 2.1 Full ICD-10 Ingestion
- [x] Create `import-icd10-codes.js` script
- [x] Parse `Knowledge/ICD-10 Files/2020 Code Descriptions/icd10cm_codes_2020.txt`
- [x] Create `icd10_codes` table (~72K codes)
- [x] Add `db.searchIcd10Codes(keyword, limit)` in `database.js`
- [x] knowledge-service uses DB when populated (fallback to JSON reference)

### 2.2 HCPCS Ingestion
- [x] Create `import-hcpcs-codes.js` script
- [x] Parse CMS HCPC2026_JAN_ANWEB fixed-width file
- [x] Create `hcpcs_codes` table
- [x] Add `db.searchHcpcsCodes(keyword, limit)`
- [x] Wire HCPCS into knowledge-service (getCodeCandidates)

### 2.3 Vector Store (Optional – Semantic Search)
- [x] semantic-search-service.js: embedText, searchCodesBySemantics, hybridSearch
- [x] code_embeddings table, populate-code-embeddings.js
- [x] Hybrid: keyword + optional semantic (useSemantic option in getCodeCandidates)
- [ ] Requires OPENAI_API_KEY and populated embeddings

### 2.4 Context Window Strategy
- [x] MAX_CONVERSATION_TURNS=10, MAX_ICD10=20, MAX_CPT=15, MAX_HCPCS=10
- [x] `assembleContext(callId, currentQuery)` in context-assembler-service.js
- [x] Returns: conversationTurns, codeCandidates (icd10, cpt, hcpcs)
- [ ] patientHistory / insuranceEligibility stubs (FHIR integration pending)

### 2.5 RAG Pipeline
- [x] getCodeCandidates(clinicalNote, options) – keyword + phrase extraction + optional semantic
- [x] Rank by match count, truncate to limits
- [x] formatContextForPrompt(context) for LLM injection
- [x] Voice agent gets candidates via search_icd10_codes / search_cpt_codes tool calls

---

## Phase 3: Tools & Retrieval

### 3.1 Tool Registry
- [x] Add to `retell-functions.json`: search_icd10_codes, search_cpt_codes, search_hcpcs_codes, validate_code_pair, assess_urgency, check_payer_guidelines, get_code_pricing
- [x] Add `check_payer_guidelines` (payer_id)
- [x] Add `get_code_pricing` (payer_id, cpt_codes, date_of_service)
- [x] Document tool schemas and usage (TOOL_SCHEMAS.md)

### 3.2 Tool Handlers
- [x] Implement handleSearchIcd10Codes, handleSearchCptCodes, handleSearchHcpcsCodes
- [x] Implement handleValidateCodePair (rule-based)
- [x] Implement handleCheckPayerGuidelines (fee-schedule-service.hasFeeScheduleForPayer)
- [x] Implement handleGetCodePricing (fee-schedule-service.getAllowedAmountsForCodes)

### 3.3 Caching
- [x] Add in-memory cache for code lookups (TTL: 24h) – cache-service.js
- [x] Cache payer guidelines (TTL: 7 days)
- [x] Cache coding rules (TTL: 30 days)
- [x] Log cache hit/miss via GET /api/admin/cache-stats; POST /api/admin/cache/clear

---

## Phase 4: Multi-Model Strategy (LOW PRIORITY – See MULTI_MODEL_REALITY_CHECK.md)

**Reality**: Multi-model affects only 2% of cost (PDF coding). Voice tools use no LLM. Only implement if evaluation shows accuracy gaps.

### 4.1 Model Router
- [ ] Create `model-router-service.js`
- [ ] Route by task: triage → Haiku, extraction → GPT-4o-mini, coding → Sonnet
- [ ] Route by complexity: simple → cheap model, complex → Sonnet
- [ ] Default: Groq Llama-3.3-70B when no override

### 4.2 Triage Model Integration
- [ ] Integrate Claude Haiku 4.5 for triage/red-flag detection
- [ ] Add `ANTHROPIC_API_KEY` to env
- [ ] Create `triage-service.js` calling Haiku
- [ ] Fast path: triage-only calls skip coding model

### 4.3 Extraction Model Integration
- [ ] Integrate GPT-4o-mini for symptom/NER extraction
- [ ] Add OpenAI client for extraction tasks
- [ ] Return structured entities (symptoms, vitals, duration)

### 4.4 Coding Model Integration
- [ ] Integrate Claude Sonnet 4.5 for complex coding (optional)
- [ ] Use for MODERATE/COMPLEX bands from coding-orchestrator
- [ ] Keep Groq for SIMPLE band

### 4.5 Cost Tracking
- [ ] Log tokens per model per call
- [ ] Add `cost_per_call` estimate (tokens × model pricing)
- [ ] Store in `voice_call_log` or new `llm_usage_log` table

---

## Phase 5: Memory & Audit

### 5.1 Conversation Memory
- [x] Persist each turn to `voice_conversation_memory` (appendConversationMemory in retell-websocket)
- [x] Include: role, content, extracted_entities
- [x] Implement `getConversationHistory(callId, limit)` for context assembly

### 5.2 Coding Decision History
- [x] Create `coding_decisions` table (id, call_id, clinic_id, patient_id, clinical_note, proposed_icd10, proposed_cpt, reasoning, confidence_score, validation_status, validation_reason, created_at)
- [x] Log on `validate_code_pair` (pre- and post-validation status)
- [x] Audit trail; 30-day retention via cleanup

### 5.3 Agent State Snapshots
- [x] Snapshot state at each stage transition (saveAgentStateSnapshot)
- [x] Enable "continue conversation" by restoring last snapshot
- [x] Retention policy: cleanupVoiceCallStateData(30)

---

## Phase 6: Safety & Validation

### 6.1 Code Existence Validation
- [x] Verify each code exists before validation (db.codeExists in handleValidateCodePair)
- [x] Reject hallucinated codes; return reason
- [x] `validateCodesExist(icd10[], cpt[])` in knowledge-service

### 6.2 Code-Pair Validation
- [x] Incompatible pairs in `Knowledge/rules/code-pair-validation.json`
- [x] `validateCodePair(icd10, cpt)` rule-based checker
- [ ] Optional: LLM fallback for edge cases

### 6.3 Red-Flag Detection
- [x] Red-flag patterns (chest pain, SOB, stroke, meningitis, etc.) in triage-service
- [x] `detectRedFlags(text)`, `checkBeforeScheduling()` 
- [x] Block scheduling when EMERGENT (handleScheduleAppointment)

### 6.4 Confidence Thresholds
- [x] Reject coding suggestions with overall confidence < 0.7 (MIN_CODING_CONFIDENCE)
- [x] Route low-confidence to manual review (status/action in coding-orchestrator)
- [x] Log confidence distribution for monitoring (llm_usage_log.confidence_score, GET /api/admin/metrics)

### 6.5 Medical Necessity (Future)
- [ ] Document payer-specific medical necessity rules
- [ ] Implement `checkMedicalNecessity(icd10, cpt, payerId)` when rules available

---

## Phase 7: Evaluation & Testing

### 7.1 Test Case Suite
- [x] Create `tests/medical-coding/test-cases.json` with ~28 cases
- [x] Each case: input (clinical note), expected urgency, icd10_contains, cpt_contains, validate_pair
- [x] Cover: emergency, urgent, routine, code retrieval, code-pair validation, edge cases
- [ ] Expand to 100+ cases (preventive, acute, chronic, multi-diagnosis)

### 7.2 Evaluation Script
- [x] Create `tests/medical-coding/evaluate-accuracy.js`
- [x] Run each test case through triage, getCodeCandidates, validateCodePair
- [x] Compare output vs expected
- [x] Compute: triage accuracy, code retrieval accuracy, code-pair validation

### 7.3 Metrics
- [x] Triage accuracy: % red flags correctly escalated
- [x] Code retrieval accuracy: % expected codes in top candidates
- [x] Code-pair validation accuracy
- [x] Hallucination rate: % proposed codes not in knowledge base (evaluate-accuracy.js --llm)
- [x] P95 latency in eval script (target: <2s documented)
- [ ] Cost per call (target: <$0.50) – llm_usage_log tracks our LLM cost

### 7.4 Baseline Measurement
- [x] Run evaluation on current system
- [x] Record baseline metrics (Jan 2026):
  - Triage (emergency/urgent): **100%**
  - Code retrieval: **100%** (phrase extraction + expansions)
  - Code-pair validation: **100%**
  - Overall: **100%** (28/28 cases)
- [x] Set improvement targets for each phase (tests/medical-coding/README.md)

### 7.5 A/B Testing (Future)
- [ ] Add experiment flag (e.g., `use_new_coding_flow`)
- [ ] Log which variant served each call
- [ ] Compare metrics across variants

---

## Phase 8: Monitoring & Optimization

### 8.1 Latency Budgets
- [x] Function call latency logged (`function_call_log.response_time_ms`)
- [x] Define max latency per stage (RUNBOOK 6.1: triage 500ms, coding 2s); alert when P95 exceeds – manual

### 8.2 Cost Tracking
- [x] voice_call_log: twilio_cost_usd, retell_cost_usd, total_cost_usd (fetchCallCosts, cost-tracker)
- [x] llm_usage_log for our LLM calls (medical-coding Groq); Retell LLM cost in Retell API
- [x] LangSmith tracing when LANGSMITH_API_KEY or AP_Langchain set

### 8.3 Performance Dashboard
- [x] /api/admin/costs, customer dashboard cost display
- [x] Aggregate: GET /api/admin/metrics (llm aggregates, confidence distribution, cache stats)

### 8.4 Caching Tuning
- [ ] Monitor cache hit rate
- [ ] Tune TTLs based on usage
- [ ] Consider Redis for production

---

## Phase 9: CDT & Dental (Lower Priority)

### 9.1 CDT Data
- [ ] Obtain structured CDT data (CSV/JSON) if available
- [ ] Create `cdt_codes` table and import script
- [ ] Add `search_cdt_codes` tool and handler
- [ ] Note: PDFs (FCL, HMSA) not easily parseable; prefer licensed data

---

## Phase 10: Documentation

### 10.1 Architecture Doc
- [x] Update `FINANCIAL_LAYER_ARCHITECTURE.md` with medical coding components
- [x] Document state flow, tools (section 6.2–6.4)
- [x] Add sequence diagrams for coding flow

### 10.2 Knowledge Base Doc
- [x] `docs/knowledge-base/README.md`: ICD-10/CPT/HCPCS ingestion status, import scripts, sources

### 10.3 Runbooks
- [x] `docs/architecture/voice-agent/RUNBOOK.md`: imports, evaluation, coding rules, troubleshooting

---

## Summary: Critical Order

1. **Phase 0** ✅ – Fix paths, CPT import, wire KB to voice
2. **Phase 1** ✅ – State management (coding-state-service, voice_call_states, etc.)
3. **Phase 2** ✅ – Full ICD-10/HCPCS + RAG (context-assembler, getCodeCandidates)
4. **Phase 3** ✅ – Tools and handlers (real-time lookup)
5. **Phase 6** ✅ – Safety and validation (compliance)
6. **Phase 7** ✅ – Evaluation (measure progress)
7. **Phase 5** ✅ – Memory & audit (coding_decisions, conversation memory)
8. **Phase 8** – Monitoring (llm_usage_log, latency)
9. **Phase 4** – Multi-model (LOW – accuracy only, conditional on eval gaps)

## Cost Optimization Priority (Voice = 98% of cost)

| Priority | Focus | Savings | Doc |
|----------|-------|---------|-----|
| 🔥 1 | Call duration (4→3 min) | ~$990/mo | MULTI_MODEL_REALITY_CHECK.md |
| 🔥 2 | Call deflection (20%) | ~$780/mo | |
| 🟡 3 | Retell usage optimization | ~$390/mo | |
| 🟢 4 | Multi-model | -$30/mo | Only if accuracy gaps |

---

*Last updated: January 2026*
