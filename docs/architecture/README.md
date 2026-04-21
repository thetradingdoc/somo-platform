# architecture — consolidated documentation

**Single file:** All former `docs/architecture/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [LangChain, LangGraph & RAG — Implementation Architecture (`ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md`)](#ai-langchain-langgraph-rag-architecture)
- [branding/LITTLELAB_BRAND (`branding/LITTLELAB_BRAND.md`)](#branding-littlelab-brand)
- [Booking blocker matrix (patient flow) (`care-delivery/BOOKING_BLOCKER_MATRIX.md`)](#care-delivery-booking-blocker-matrix)
- [Booking + Checkout Pending Tasks (Today) (`care-delivery/BOOKING_CHECKOUT_PENDING_TODAY.md`)](#care-delivery-booking-checkout-pending-today)
- [Booking Rollout Checklist (`care-delivery/BOOKING_ROLLOUT_CHECKLIST.md`)](#care-delivery-booking-rollout-checklist)
- [Video Consult — Architecture, Env & Runbook (`care-delivery/VIDEO_CONSULT.md`)](#care-delivery-video-consult)
- [Agentic checkout — file map (`commerce/AGENTIC_CHECKOUT_FILE_MAP.md`)](#commerce-agentic-checkout-file-map)
- [Agentic Commerce Rollout Plan (`commerce/AGENTIC_COMMERCE_ROLLOUT_PLAN.md`)](#commerce-agentic-commerce-rollout-plan)
- [Public agentic checkout (catalog → quote → pay) (`commerce/PUBLIC_AGENTIC_CHECKOUT.md`)](#commerce-public-agentic-checkout)
- [Database Schema Approach for Multi-Tenancy (`database/DATABASE_SCHEMA_APPROACH.md`)](#database-database-schema-approach)
- [ADR 001: SQLite as default application database (`decisions/001-persistence-sqlite.md`)](#decisions-001-persistence-sqlite)
- [ADR 002: Kelly uses a pluggable primary LLM (Anthropic vs Groq) (`decisions/002-kelly-multi-llm.md`)](#decisions-002-kelly-multi-llm)
- [ADR 003: Agentic checkout spans static web, native app, and public APIs (`decisions/003-agentic-checkout-surfaces.md`)](#decisions-003-agentic-checkout-surfaces)
- [Architecture Decision Records (ADR) (`decisions/README.md`)](#decisions-readme)
- [Phase 0 — Derm patient Q&A: scope, intent taxonomy, metrics, positioning (`derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md`)](#derm-patient-qa-phase-0-scope-and-metrics)
- [Phase 2 — Derm patient Q&A triage (`derm-patient-qa/PHASE_2_TRIAGE.md`)](#derm-patient-qa-phase-2-triage)
- [Phase 3 — Derm patient education corpus & retrieval (`derm-patient-qa/PHASE_3_CORPUS_AND_INDEX.md`)](#derm-patient-qa-phase-3-corpus-and-index)
- [Phase 4 — Answer generation and safety (`derm-patient-qa/PHASE_4_ANSWER_AND_SAFETY.md`)](#derm-patient-qa-phase-4-answer-and-safety)
- [Phase 5 — Product / API wiring (`derm-patient-qa/PHASE_5_PRODUCT_WIRING.md`)](#derm-patient-qa-phase-5-product-wiring)
- [Skin & Care landing — Try now & LiveKit (`experience/LANDING_TRY_NOW_LIVEKIT.md`)](#experience-landing-try-now-livekit)
- [Skin & Care — tokens, assets, and env (frontend) (`experience/SKIN_CARE_TOKENS_AND_ASSETS.md`)](#experience-skin-care-tokens-and-assets)
- [FHIR‑Native RCM Mapping (2026) — EMPI + EDI → FHIR (`financial/FHIR_NATIVE_RCM_MAPPING.md`)](#financial-fhir-native-rcm-mapping)
- [DocLittle Financial Layer - Detailed Architecture Document (`financial/FINANCIAL_LAYER_ARCHITECTURE.md`)](#financial-financial-layer-architecture)
- [Impact Community and Token Strategy (`financial/IMPACT_COMMUNITY_TOKEN_STRATEGY.md`)](#financial-impact-community-token-strategy)
- [Provider Trust Score Probationary Period (`financial/PROVIDER_TRUST_PROBATION.md`)](#financial-provider-trust-probation)
- [Static Records Audit (`financial/STATIC_RECORDS_AUDIT.md`)](#financial-static-records-audit)
- [Stuck Escrow Recovery System (`financial/STUCK_ESCROW_RECOVERY.md`)](#financial-stuck-escrow-recovery)
- [Tiba & Billing — Consolidated Todo (`financial/TIBA_AND_BILLING_TODO.md`)](#financial-tiba-and-billing-todo)
- [Healthcare Use Case Assessment (`healthcare/HEALTHCARE_ASSESSMENT.md`)](#healthcare-healthcare-assessment)
- [Layer 1: Multimodal Perception Layer (`intelligence-layer/LAYER1_PERCEPTION_IMPLEMENTATION_GUIDE.md`)](#intelligence-layer-layer1-perception-implementation-guide)
- [Multimodal Medical AI Agent Architecture (`intelligence-layer/MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md`)](#intelligence-layer-multimodal-medical-ai-architecture)
- [Intelligence Layer Architecture (`intelligence-layer/README.md`)](#intelligence-layer-readme)
- [Architecture Issues Analysis (`maintenance/ARCHITECTURE_ISSUES.md`)](#maintenance-architecture-issues)
- [DocLittle Media Layer – Architecture Document (`media/MEDIA_LAYER_ARCHITECTURE.md`)](#media-media-layer-architecture)
- [Middleware Brain Improvements - Gap Analysis & Implementation Status (`middleware/MIDDLEWARE_BRAIN_GAP_ANALYSIS.md`)](#middleware-middleware-brain-gap-analysis)
- [Middleware Brain Improvements: Code Changes & Impact (`middleware/MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md`)](#middleware-middleware-brain-improvements-implementation)
- [Multi-Tenant Voice Agent Architecture (`multi-tenant/MULTI_TENANT_VOICE_AGENT.md`)](#multi-tenant-multi-tenant-voice-agent)
- [Multi-Tenant Clinic Signup Implementation (`multi-tenant/multi-tenant-signup-implementation.md`)](#multi-tenant-multi-tenant-signup-implementation)
- [DocLittle Platform: Architecture Overview & Colab RAG Integration (`overview/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`)](#overview-architecture-overview-and-colab-rag)
- [Hybrid Architecture — Improvements (Implemented) (`overview/HYBRID_ARCHITECTURE_IMPROVEMENTS.md`)](#overview-hybrid-architecture-improvements)
- [Hybrid Architecture — One-Page Overview (`overview/HYBRID_ARCHITECTURE_OVERVIEW.md`)](#overview-hybrid-architecture-overview)
- [RAG Integration: File Extraction vs Translation Layer (`overview/RAG_INTEGRATION_APPROACHES.md`)](#overview-rag-integration-approaches)
- [Local Test Runbook — Patient Journey & Landing (`patients/LOCAL_TEST_RUNBOOK.md`)](#patients-local-test-runbook)
- [Patient Architecture — Voice, Chat, UI & Session (`patients/PATIENT_ARCHITECTURE.md`)](#patients-patient-architecture)
- [Patient Orchestrator — `session_id` vs `triage_sessions` (C1 / impl-5) (`patients/PATIENT_ORCHESTRATOR_TRIAGE_PROVENANCE.md`)](#patients-patient-orchestrator-triage-provenance)
- [patients/PATIENT_WALLET (`patients/PATIENT_WALLET.md`)](#patients-patient-wallet)
- [Payment Architecture Overview (`payments/PAYMENT_ARCHITECTURE.md`)](#payments-payment-architecture)
- [Payment Environment Variables & Flow Diagrams (`payments/PAYMENT_ENV_AND_FLOWS.md`)](#payments-payment-env-and-flows)
- [Payment Token Flow (Task 25) (`payments/PAYMENT_TOKEN_FLOW.md`)](#payments-payment-token-flow)
- [Doctor Dashboard Rebuild TODOs (`providers/DOCTOR_DASHBOARD_REBUILD_TODOS.md`)](#providers-doctor-dashboard-rebuild-todos)
- [Provider/Prescription DB Rename Phase 2 Plan (Optional) (`providers/PROVIDER_PRESCRIPTION_DB_PHASE2_PLAN.md`)](#providers-provider-prescription-db-phase2-plan)
- [Provider/Prescription Naming Migration Guide (`providers/PROVIDER_PRESCRIPTION_NAMING_MIGRATION_GUIDE.md`)](#providers-provider-prescription-naming-migration-guide)
- [Provider/Prescription Rollout Checklist (`providers/PROVIDER_PRESCRIPTION_ROLLOUT_CHECKLIST.md`)](#providers-provider-prescription-rollout-checklist)
- [Architecture Documentation (`README.md`)](#readme)
- [Vision UV R&D (separate track) (`vision/VISION_UV_R_AND_D.md`)](#vision-vision-uv-r-and-d)
- [🎯 Platform Vision: "Plaid for AI Agents" (`vision/VISION.md`)](#vision-vision)
- [Automated Retell Agent Creation (`voice-agent/AUTOMATED_RETELL_AGENT_CREATION.md`)](#voice-agent-automated-retell-agent-creation)
- [Multi-Model Reality Check – Architecture & Cost Analysis (`voice-agent/MULTI_MODEL_REALITY_CHECK.md`)](#voice-agent-multi-model-reality-check)
- [Real-Time Language Switching During Calls (`voice-agent/REAL_TIME_LANGUAGE_SWITCHING.md`)](#voice-agent-real-time-language-switching)
- [Medical Coding Voice Agent – Runbook (`voice-agent/RUNBOOK.md`)](#voice-agent-runbook)
- [Medical Coding Voice Agent – State Flow (`voice-agent/STATE_FLOW.md`)](#voice-agent-state-flow)
- [Medical Coding Voice Agent – Tool Schemas & Usage (`voice-agent/TOOL_SCHEMAS.md`)](#voice-agent-tool-schemas)
- [Voice Agent — Todo & Implementation Status (`voice-agent/VOICE_AGENT_TODO_AND_STATUS.md`)](#voice-agent-voice-agent-todo-and-status)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="ai-langchain-langgraph-rag-architecture"></a>

## LangChain, LangGraph & RAG — Implementation Architecture

*Former path: `docs/architecture/ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md`*

This document describes how LangChain, LangGraph, and RAG are implemented in the DocLittle middleware platform, and how state, memory, context window, evaluation, and strategy are architected.

---

## Part 1: LangChain, LangGraph & RAG Implementation

### 1.1 LangChain Implementation

LangChain is used to wrap LLM calls so they are traced in LangSmith. All traced services load `langsmith-config` and use `@langchain/groq` (ChatGroq) or `@langchain/openai` (OpenAIEmbeddings) when available.

#### Files

| File | Purpose |
|------|---------|
| `utils/langsmith-config.js` | Sets `LANGCHAIN_TRACING_V2`, `LANGCHAIN_PROJECT`; warns/fails in production if key missing |
| `services/medical-coding-service.js` | ChatGroq for ICD-10/CPT suggestions |
| `services/chat-llm-service.js` | ChatGroq for natural language command understanding |
| `services/admin-ai-assistant-service.js` | Uses ChatLLMService (inherits LangChain tracing) |
| `services/semantic-search-service.js` | OpenAIEmbeddings for embedding queries (traced when available) |

#### Code: LangSmith Config

```javascript
// utils/langsmith-config.js
if (process.env.AP_Langchain && !process.env.LANGSMITH_API_KEY) {
  process.env.LANGSMITH_API_KEY = process.env.AP_Langchain;
}
if (process.env.LANGSMITH_API_KEY && process.env.LANGCHAIN_TRACING_V2 !== 'false') {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
}
// P0: Production enforcement
if (isProd && (!hasKey || tracingOff)) {
  if (process.env.LANGSMITH_MANDATORY === 'true') process.exit(1);
  console.warn('⚠️  LangSmith: Production requires LANGSMITH_API_KEY...');
}
```

#### Code: Medical Coding (ChatGroq)

```javascript
// services/medical-coding-service.js
const model = new ChatGroq({
  apiKey: GROQ_API_KEY,
  model: DEFAULT_MODEL,
  temperature: 0.2,
  streaming: false,
  response_format: { type: 'json_object' }
});
const runnableConfig = {
  runName: `medical_coding_${operation}`,
  tags: ['medical-coding', 'doctor-little', operation, `clinic:${clinicId}`, `call:${callId}`],
  metadata: { clinic_id: clinicId, call_id: callId, operation }
};
const res = await model.invoke(
  [new SystemMessage(systemContent), new HumanMessage(userContent)],
  runnableConfig
);
```

#### Code: Chat LLM (fallback pattern)

```javascript
// services/chat-llm-service.js
if (this._useLangChain()) {
  const chatModel = new ChatGroq({ apiKey, model, temperature, maxTokens });
  const res = await chatModel.invoke(msgs);
  response = res?.content;
} else {
  const completion = await this.groq.chat.completions.create({ messages, model, ... });
  response = completion.choices[0]?.message?.content;
}
```

---

### 1.2 LangGraph Implementation

LangGraph drives the voice-agent state machine for medical coding. It persists state via a checkpointer and dual-writes to the DB.

#### Files

| File | Purpose |
|------|---------|
| `services/coding-graph.js` | StateGraph, checkpointer, processTurn |
| `services/coding-state-service.js` | Pure logic: computeNextStage, FUNCTION_TO_STAGE |
| `webhooks/retell-websocket.js` | Calls CodingGraph.processTurn on transcript + function_call |
| `utils/feature-flags.js` | langgraph_enabled flag (DB/env) |

#### State Schema (Annotation)

```javascript
// services/coding-graph.js
const CodingStateAnnotation = Annotation.Root({
  current_stage: Annotation(),
  state_data: Annotation(),
  clinic_id: Annotation(),
  last_trigger: Annotation(),
  last_trigger_reason: Annotation(),
  from_stage: Annotation(),
  transition: Annotation()
});
```

#### Graph Structure

Single-node graph: `START → apply_trigger → END`

```javascript
const workflow = new StateGraph(CodingStateAnnotation)
  .addNode('apply_trigger', (state) => {
    const { nextStage, transition, reason } = computeNextStage(
      state.current_stage || 'INTAKE',
      state.last_trigger || 'transcript',
      (state.state_data || {}).triggerPayload || {}
    );
    return {
      current_stage: nextStage,
      state_data: { ...state.state_data, last_trigger, last_trigger_reason, ... },
      from_stage: state.current_stage,
      transition,
      last_trigger_reason: reason
    };
  })
  .addEdge(START, 'apply_trigger')
  .addEdge('apply_trigger', END);

compiledGraph = workflow.compile({ checkpointer });
```

#### Checkpointer

- **Dev**: `MemorySaver` (in-memory)
- **Prod**: `PostgresSaver` when `POSTGRES_URL` + `NODE_ENV=production` or `LANGGRAPH_USE_POSTGRES=true`

```javascript
// services/coding-graph.js
async function getCheckpointer() {
  const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  const usePostgres = connStr && (process.env.NODE_ENV === 'production' || process.env.LANGGRAPH_USE_POSTGRES === 'true');
  if (usePostgres) {
    const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
    const cp = PostgresSaver.fromConnString(connStr, { schema: 'public' });
    await cp.setup();
    return cp;
  }
  return new LG.MemorySaver();
}
```

#### processTurn Flow

```javascript
// services/coding-graph.js
async function processTurn(db, callId, triggerType, triggerPayload, options = {}) {
  const graph = await getGraph(db);
  const currentState = db?.getCallState?.(callId) || null;
  const input = {
    current_stage: currentState?.current_stage || 'INTAKE',
    state_data: { ...(currentState?.state_data || {}), triggerPayload },
    clinic_id: options.clinic_id ?? currentState?.clinic_id,
    last_trigger: triggerType
  };
  const config = {
    configurable: { thread_id: callId },
    runName: `coding_state_${triggerType}`,
    tags: ['coding-graph', 'doctor-little', triggerType],
    metadata: { callId, clinic_id: options.clinic_id }
  };
  const result = await graph.invoke(input, config);
  // Dual-write to voice_call_states when rollout >= 100% or shadow
  if (db?.upsertCallState && (ROLLOUT_PCT >= 1 || SHADOW_MODE)) {
    db.upsertCallState(callId, { clinic_id, current_stage: result.current_stage, state_data: result.state_data });
  }
  return { state: result, transition, fromStage, toStage };
}
```

---

### 1.3 RAG (Retrieval-Augmented Generation) Implementation

RAG augments prompts with retrieved medical codes. Retrieval combines keyword search and optional semantic (embedding) search.

#### Files

| File | Purpose |
|------|---------|
| `services/knowledge-service.js` | getCodeCandidates, keyword + phrase extraction, optional semantic merge |
| `services/semantic-search-service.js` | embedText, searchCodesBySemantics, hybridSearch |
| `services/context-assembler-service.js` | assembleContext, formatContextForPrompt, smartTruncate |
| `scripts/populate-code-embeddings.js` | Pre-populates code_embeddings table |
| `database.js` | code_embeddings, upsertCodeEmbedding, getAllCodeEmbeddings, getCodeEmbeddingsCount |

#### RAG Pipeline: getCodeCandidates

```javascript
// services/knowledge-service.js - _getCodeCandidatesImpl
// 1. Keyword retrieval
const phrases = extractMedicalPhrases(note);
const keywords = extractKeywords(note, 15);
for (const phrase of phrases) {
  (searchIcd10Codes(phrase, ICD10_PER_TERM) || []).forEach(r => addIcd10(r, PHRASE_MATCH_BOOST));
  (searchCptCodesCached(phrase, CPT_PER_TERM) || []).forEach(r => addCpt(r, PHRASE_MATCH_BOOST));
  // ...
}
for (const kw of keywords) {
  (searchIcd10Codes(kw, ICD10_PER_TERM) || []).forEach(r => addIcd10(r));
  // ...
}

// 2. Optional semantic merge (hybrid)
if (useSemantic) {
  const semanticService = require('./semantic-search-service');
  const hybrid = await semanticService.hybridSearch(note, { limit, codeTypes: ['icd10','cpt','hcpcs'] });
  hybrid.forEach(r => {
    if (r.code_type === 'icd10' && !icd10.some(c => c.code === r.code))
      icd10.push({ code: r.code, description: r.description, confidence: r.score || 0.7 });
    // ... cpt, hcpcs
  });
}
```

#### Semantic Search (Embeddings)

```javascript
// services/semantic-search-service.js
async function embedText(text) {
  if (OpenAIEmbeddings && process.env.LANGCHAIN_TRACING_V2 !== 'false') {
    const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small', openAIApiKey });
    return await embeddings.embedQuery(input);
  }
  // Fallback: raw fetch to OpenAI embeddings API
  const res = await fetch('https://api.openai.com/v1/embeddings', { ... });
  return json.data?.[0]?.embedding;
}

async function searchCodesBySemantics(query, topK, codeType) {
  const queryEmbedding = await embedText(q);
  const rows = db.getAllCodeEmbeddings(codeType);
  const scored = rows.map(r => ({ ...r, score: cosineSimilarity(queryEmbedding, r.embedding) }));
  return scored.filter(r => r.score > 0.3).sort((a,b) => b.score - a.score).slice(0, topK);
}

async function hybridSearch(query, options) {
  const keywordResults = []; // searchIcd10Codes, searchCptCodes, searchHcpcsCodes
  const semanticResults = await searchCodesBySemantics(query, limit * 2, null);
  // Merge: keyword base score 0.5, semantic adds; dedupe by code
  // ...
}
```

#### Where RAG Is Used

| Caller | Retrieval | LLM |
|--------|-----------|-----|
| `handleSuggestCodesFromSymptoms` (retell-websocket) | `knowledgeService.getCodeCandidates` (keyword + optional semantic) | No LLM; returns retrieved codes |
| `generateCodingSuggestion` (medical-coding-service) | `getCandidateCptCodes` + `getReferenceIcdCodes` (keyword) | ChatGroq with buildPrompt |
| `assembleContext` (context-assembler) | `getCodeCandidates` + conversation history + patient history | Used by callers that inject into prompts |

---

## Part 2: State, Memory, Context Window, Evaluation & Strategy

### 2.1 State Architecture

#### Voice Call State (Persistent)

| Component | Location | Purpose |
|-----------|----------|---------|
| `voice_call_states` | database.js | Per-call state: current_stage, state_data, clinic_id |
| `getCallState` | database.js | Load state by call_id |
| `upsertCallState` | database.js | Persist state |

Schema:

```sql
CREATE TABLE voice_call_states (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL UNIQUE,
  clinic_id TEXT,
  current_stage TEXT,
  state_data TEXT,  -- JSON
  updated_at TEXT
);
```

#### LangGraph Checkpointer State

- **MemorySaver**: In-process; lost on restart
- **PostgresSaver**: Stored in Postgres `checkpoints` table; thread_id = call_id

#### State Flow

1. **Transcript** or **function_call** → retell-websocket
2. If LangGraph enabled → `CodingGraph.processTurn(db, callId, triggerType, payload, { clinic_id })`
3. LangGraph loads prior state from checkpointer (or DB when hydrating input)
4. `computeNextStage` (coding-state-service) determines next stage
5. Graph writes new checkpoint; dual-writes to `voice_call_states` when rollout/shadow

#### Stage Transitions (Strategy)

```javascript
// services/coding-state-service.js
const STAGES = ['INTAKE', 'EXTRACTION', 'TRIAGE', 'CODING', 'VALIDATION', 'BILLING'];
const FUNCTION_TO_STAGE = {
  suggest_codes_from_symptoms: 'CODING',
  validate_code_pair: 'VALIDATION',
  collect_insurance: 'BILLING',
  schedule_appointment: 'INTAKE',
  // ...
};

// transcript: INTAKE → EXTRACTION (first user turn); otherwise no change
// function_call: Advance to target stage per FUNCTION_TO_STAGE; CODING + coding fn → VALIDATION
```

---

### 2.2 Memory Architecture

#### Conversation Memory

| Table | Purpose |
|-------|---------|
| `voice_conversation_memory` | Per-turn transcript: call_id, role, content, extracted_entities |

```javascript
// database.js
appendConversationMemory(callId, role, content, clinic_id, extracted_entities)
getConversationHistory(callId, limit)
```

#### Patient History (Long-term)

| Table/Function | Purpose |
|----------------|---------|
| `patient_coding_history` | Prior encounter codes for a patient |
| `getPatientIdForCall` | Resolve patient_id from fhir_encounters by call_id |
| `getPatientCodingHistory` | Prior ICD-10/CPT for patient |

#### Agent State Snapshots

| Table | Purpose |
|-------|---------|
| `agent_state_snapshots` | Auditable snapshots of stage transitions (state_name, snapshot_data) |

---

### 2.3 Context Window Architecture

#### Token Budget (Per-Call)

```javascript
// utils/token-budget.js
const MAX_TOKENS_PER_CALL = parseInt(process.env.MAX_TOKENS_PER_CALL || '10000', 10);

addTokens(callId, { prompt_tokens, completion_tokens })
getUsed(callId)
canProceed(callId, estimatedTokens)
reset(callId)  // On call end
```

#### Context Assembler

```javascript
// services/context-assembler-service.js
const MAX_CONVERSATION_TURNS = 10;
const MAX_ICD10_CANDIDATES = 20;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function smartTruncate(transcript, maxTokens = 2000) {
  // Prefer segments with medical keywords; cap by token estimate
  const medicalKeywords = /\b(patient|symptom|pain|diagnosis|...)\b/gi;
  const segments = transcript.split(/(?<=[.!?])\s+/);
  const scored = segments.map(s => ({ text: s, score: (s.match(medicalKeywords)||[]).length, tokens: estimateTokens(s) }));
  scored.sort((a,b) => b.score - a.score);
  // Take segments until budget exhausted
  // ...
}

async function assembleContext(callId, currentQuery, options = {}) {
  const tokenBudget = options.tokenBudget ?? 8000;
  const queryBudget = Math.floor(tokenBudget * 0.3);
  const truncatedQuery = smartTruncate(currentQuery, queryBudget);
  const remainingForTurns = tokenBudget - estimateTokens(truncatedQuery);
  const maxTurns = Math.min(MAX_CONVERSATION_TURNS, Math.floor(remainingForTurns / 150));
  const conversationTurns = db.getConversationHistory(callId, maxTurns);
  const codeCandidates = await knowledgeService.getCodeCandidates(truncatedQuery, { ... });
  const patientHistory = options.includePatientHistory ? db.getPatientCodingHistory(patientId, 10) : null;
  return { conversationTurns, codeCandidates, patientHistory, truncatedQuery, tokensUsed, tokenBudget, budgetRemaining };
}
```

#### Medical Coding Prompt Budget

- Clinical note: `MAX_NOTE_LENGTH = 4000` chars (truncate from end)
- Token budget check before Groq: `canProceed(callId, estimatedTokens)`; fallback to knowledge-service if exceeded

---

### 2.4 Evaluation Architecture

#### Scripts & Test Files

| File | Purpose |
|------|---------|
| `scripts/evaluate-accuracy.js` | Voice-agent test cases: triage, extraction, validation; ACCURACY_THRESHOLD (default 70%) |
| `tests/medical-coding/evaluate-accuracy.js` | Full pipeline: triage, code retrieval, validation; optional `--llm` for hallucination check |
| `tests/medical-coding/voice-agent-test-cases.json` | Test cases (expected urgency, blocks_scheduling, icd10_contains, etc.) |
| `tests/medical-coding/test-cases.json` | Additional pipeline test cases |
| `tests/state-transitions.test.js` | Unit tests for computeNextStage |
| `tests/tool-handlers/validate-code-pair.test.js` | Code pair validation |
| `tests/tool-handlers/suggest-codes.test.js` | suggest_codes flow |

#### Evaluation Metrics

- **Triage accuracy**: `detectRedFlags`, `checkBeforeScheduling` vs expected urgency, blocks_scheduling
- **Code retrieval**: keyword/semantic top-K contains expected ICD-10/CPT
- **Code-pair validation**: `validateCodePair` vs expected valid/invalid
- **Hallucination rate** (--llm): LLM-proposed codes not in knowledge base
- **P95 latency**: From evaluation runs

```javascript
// scripts/evaluate-accuracy.js
const triage = detectRedFlags(input);
const scheduling = checkBeforeScheduling([{ role: 'user', content: input }]);
result.checks.push({ field: 'urgency', expected: expected.urgency, actual: triage?.urgency, passed: match });
// ...
// Exit code 0 if accuracy >= ACCURACY_THRESHOLD (70%), else 1
```

---

### 2.5 Strategy Architecture

#### State Machine Strategy

- **Deterministic**: `computeNextStage` is pure; no LLM for transitions
- **Function-driven**: Tool invocations drive stage advances (e.g. suggest_codes → CODING → VALIDATION)
- **Transcript-driven**: First user utterance moves INTAKE → EXTRACTION

#### Retrieval Strategy

- **Keyword-first**: Phrase match (boost 2) + keyword match; always runs
- **Semantic-optional**: When `semantic_search_enabled` and embeddings exist; merges with keyword results
- **Validation-gate**: All proposed codes must pass `validateCodesExist`; invalid codes filtered

#### Fallback Strategy

| Condition | Fallback |
|-----------|----------|
| Groq unavailable | knowledge-service (getCandidateCptCodes, getReferenceIcdCodes) |
| Token budget exceeded | knowledge-service |
| Monthly cost cap exceeded | knowledge-service |
| LangGraph null/fail | coding-state-service.processTurn (legacy) |
| Semantic search off/fail | Keyword-only in getCodeCandidates |

---

## Summary Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RETELL WEBSOCKET                                     │
│  transcript / function_call → CodingGraph.processTurn OR processCodingStateTurn │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   LANGGRAPH     │         │  KNOWLEDGE SVC   │         │  MEDICAL CODING │
│  StateGraph     │         │ getCodeCandidates│         │ generateCoding  │
│  apply_trigger  │         │ keyword+semantic │         │ ChatGroq+LK     │
│  checkpointer   │         │ hybridSearch     │         │ buildPrompt     │
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │ dual-write                │                           │
         ▼                           ▼                           ▼
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│ voice_call_     │         │ semantic-search │         │ token-budget    │
│ states          │         │ embedText       │         │ canProceed      │
│ (DB)            │         │ code_embeddings │         │ addTokens       │
└─────────────────┘         └─────────────────┘         └─────────────────┘
         │
         │ checkpoint
         ▼
┌─────────────────┐
│ MemorySaver /   │
│ PostgresSaver   │
└─────────────────┘
```


---

<a id="branding-littlelab-brand"></a>

## branding/LITTLELAB_BRAND

*Former path: `docs/architecture/branding/LITTLELAB_BRAND.md`*

## LittleLab Brand Guidelines (v0)

**Name**: LittleLab  
**Tagline**: *Your virtual care companion.*

---

### 1. Positioning

- LittleLab is the **patient-facing** and **clinic-facing** brand for the virtual care + coding assistant experience.
- The brand should feel:
  - **Calm**: soft gradients, plenty of whitespace/dark-space.
  - **Competent**: clear typography, precise language.
  - **Companion-like**: copy is friendly but not casual; avoids jokes.

---

### 2. Naming & Usage

- Use **LittleLab** (one word, capital L’s) in:
  - Page titles (e.g., “LittleLab Patient Portal”).
  - Logos/wordmarks on patient and provider UIs.
- Avoid mixing **DocLittle** on any new patient-facing flows.
  - Existing legacy references can remain behind the scenes but should be gradually migrated.

Examples:

- ✅ “LittleLab Patient Portal”
- ✅ “Welcome to LittleLab”
- ❌ “DocLittle Patient Portal” (deprecated for new UIs)

---

### 3. Core Copy Snippets

You can reuse these snippets across landing, login, and email surfaces.

- **Short hero line**:
  - “Your virtual care companion.”
- **Landing sub-copy**:
  - “Search symptoms, conditions, and visits. LittleLab turns them into clear next steps for you and your care team.”
- **Patient login intro**:
  - “Access your LittleLab portal with a secure 6-digit code.”
- **Provider login intro**:
  - “Sign in to your LittleLab clinic dashboard.”

---

### 4. Tone & Style

- **Plain language**:
  - Prefer “visit”, “appointment”, “records” over billing jargon.
- **Reassuring**:
  - Acknowledge uncertainty, point to clear actions.
- **No diagnosis promises**:
  - Emphasise that LittleLab surfaces information and connects patients with clinicians; it does **not** replace medical judgement.

---

### 5. Visual Direction (landing reference)

- **Typography**:
  - Headlines: `Playfair Display`, semi-condensed, large, with subtle gradient.
  - Body: `Inter` or `Inter var`, 14–16 px, relaxed line-height.
- **Color**:
  - Backgrounds: deep navy / midnight (`#050915` onwards).
  - Accent: warm gold (`#E8B059`) for highlights and cursor.
  - Status: emerald for “healthy/connected”, muted red only when necessary.

---

### 6. Where to Apply

- New 3D landing search (LittleLab React app).
- `unified-dashboard/patients/*`:
  - Titles, logos, and subtitles.
- Provider dashboard login and any new clinic-facing pages.



---

<a id="care-delivery-booking-blocker-matrix"></a>

## Booking blocker matrix (patient flow)

*Former path: `docs/architecture/care-delivery/BOOKING_BLOCKER_MATRIX.md`*


Reference for tests and ops. Maps phases to owners and status.

## Phases

| Phase | Owner | Status |
|------|--------|--------|
| Phase 1 - Get Slots | Platform / booking service | Active |
| Phase 2 - Schedule | Platform / FHIR bridge | Active |
| Phase 3 - Checkout | Payments / Stripe | Active |
| Phase 4 - Verify and Pay | Voice + email verification | Active |
| Infrastructure | DevOps / middleware | Active |

## Notes

- Patient calendar uses clinic-local civil dates (`schedule.html` + `isoDateInTz`).
- See also `docs/testing/README.md#agentic-checkout-e2e-checklist` for commerce E2E.


---

<a id="care-delivery-booking-checkout-pending-today"></a>

## Booking + Checkout Pending Tasks (Today)

*Former path: `docs/architecture/care-delivery/BOOKING_CHECKOUT_PENDING_TODAY.md`*

This file contains only the pending work discussed today.

## P0 - User-facing booking failure clarity

- [x] Return specific duplicate-identity errors from Kelly instead of generic fallback text.
- [x] In `kelly-agent-service` server-side scheduling intercept, map duplicate/phone-confirmation cases to explicit patient guidance.
- [x] Ensure UI/chat response explains what to do next (confirm phone/email) when duplicate identity is detected.

## P0 - Checkout completion blockers

- [x] Audit and patch all paths where booking succeeds but checkout does not complete (voice and chat entry points).
- [x] Verify auto-checkout + manual checkout do not conflict and cannot create ambiguous user state.
- [x] Ensure verification flow returns actionable error codes/messages (expired code, invalid code, missing token).

## P1 - Inbound booking path consistency

- [x] Re-verify inbound call flow for all four journeys:
  - symptoms + immediate
  - symptoms + routine
  - no symptoms + immediate
  - no symptoms + routine
- [x] Confirm triage/urgency gates are consistent across UI and backend for each journey.

## P1 - Observability and debugging

- [x] Add/verify structured logs for schedule failure causes (duplicate, triage gate, insurance gate, checkout gate).
- [x] Add/verify correlation across triage -> slot lookup -> schedule -> checkout -> verify steps.
- [x] Confirm there is no silent fallback that hides root cause in patient-facing copy.

## P2 - Validation and rollout checks

- [x] Execute end-to-end test runs for booking + checkout in chat and inbound call modes.
- [x] Add/refresh regression tests for duplicate identity, checkout token loss, and verify-code failure paths.
- [x] Produce a final go-live checklist for "someone can always book and pay, or receives a precise actionable error."

## P0 - Calendar reliability (provider sync vs manual availability)

- [x] Define and enforce booking policy tiers for sync visits:
  - Tier A: Google connected + availability blocks (highest confidence)
  - Tier B: Availability blocks only, no Google (allow booking with warnings)
  - Tier C: No Google and no blocks (do not offer sync slots)
- [x] Add explicit feature flags:
  - `CALENDAR_REQUIRED_FOR_SYNC`
  - `PREFER_SYNCED_PROVIDERS`
  - `BLOCKS_ONLY_ALLOWED`
- [x] Remove calendar ambiguity by documenting source of truth for each lane:
  - sync lane: Google + blocks (or blocks-only fallback by policy)
  - async lane: quota + provider availability rules

## P0 - Backend behavior fixes (calendar selection + matching)

- [x] Implement deterministic provider calendar resolution order:
  - provider user selected calendar
  - provider primary calendar
  - clinic calendar fallback (if allowed)
  - env shared calendar fallback (if allowed)
- [x] Add a single `calendar_confidence` field to slot responses (`high`, `medium`, `low`) based on source.
- [x] Prioritize synced providers first when multiple providers match the same slot window.
- [x] Return structured error codes for calendar gating:
  - `PROVIDER_CALENDAR_NOT_CONNECTED`
  - `PROVIDER_AVAILABILITY_NOT_SET`
  - `NO_BOOKABLE_SYNC_PROVIDER`
- [x] Ensure provider without Google but with blocks is still schedulable when policy permits.
- [x] Ensure provider without Google and without blocks is excluded from sync slot generation.

## P1 - Provider UX and settings fixes

- [x] Add provider status badges in UI:
  - `Live calendar connected`
  - `Availability blocks only`
  - `Unavailable`
- [x] Add actionable CTAs in settings:
  - Connect Google calendar
  - Set weekly availability blocks
  - Test booking readiness
- [x] Show non-blocking warning for blocks-only mode:
  - "External calendar conflicts may not be detected."
- [x] Add per-specialist "Booking readiness" card with pass/fail checks:
  - online status
  - active provider profile
  - calendar connected (optional by policy)
  - availability blocks set

## P1 - Patient/agent experience improvements

- [x] Keep patient-facing copy simple and non-technical for calendar fallback cases.
- [x] Auto-suggest next available business day when selected day has no slots.
- [x] If no sync-capable provider is available, offer:
  - next date search
  - async review lane
  - callback/manual scheduling fallback
- [x] Ensure Kelly never says "booked" before schedule success and calendar checks pass.

## P1 - Data model and migration tasks

- [x] Add canonical link between specialist and calendar credentials (`provider_profiles.user_id -> users.id`).
- [x] Add `provider_booking_readiness` materialized/derived state for quick checks.
- [x] Add `calendar_confidence` and `calendar_source` to appointment metadata.
- [x] Backfill existing providers:
  - map user email -> provider profile
  - detect missing calendar connection
  - detect missing availability blocks

## P2 - Observability, alerts, and guardrails

- [x] Add metrics:
  - `% slots from high/medium/low confidence sources`
  - `% bookings created with blocks-only providers`
  - `% no-bookable-provider failures by clinic`
- [x] Add warning logs with stable codes for every fallback step.
- [x] Add alert when blocks-only booking volume exceeds threshold (signals integration drift).
- [x] Add audit trail event when booking proceeded without Google sync.

## P2 - Test plan and rollout

- [x] Unit tests for calendar resolution priority and policy flag combinations.
- [x] Integration tests for all provider states:
  - connected + blocks
  - connected + no blocks
  - not connected + blocks
  - not connected + no blocks
- [x] E2E tests:
  - patient sees valid slots when provider is blocks-only
  - patient gets clean fallback when no provider is bookable
- [x] Staged rollout:
  - enable `PREFER_SYNCED_PROVIDERS`
  - validate metrics
  - decide whether to enforce `CALENDAR_REQUIRED_FOR_SYNC`



---

<a id="care-delivery-booking-rollout-checklist"></a>

## Booking Rollout Checklist

*Former path: `docs/architecture/care-delivery/BOOKING_ROLLOUT_CHECKLIST.md`*

## Stage 0 - Preflight

- Confirm provider readiness endpoint returns expected rows for target clinic.
- Confirm booking observability endpoint returns confidence percentages and alerts.
- Run provider readiness backfill script:
  - `node middleware-platform/scripts/backfill-provider-calendar-readiness.js`

## Stage 1 - Safe Enablement

- Enable `PREFER_SYNCED_PROVIDERS=true`.
- Keep `CALENDAR_REQUIRED_FOR_SYNC=false`.
- Keep `BLOCKS_ONLY_ALLOWED=true`.
- Monitor `% slots high/medium/low confidence` and `% blocks-only bookings`.

## Stage 2 - Stability Validation

- Verify no-bookable-provider failures by clinic stay below threshold.
- Verify fallback copy appears in Kelly for:
  - no online specialist
  - blocks not configured
  - calendar not connected
- Verify provider settings shows readiness badges and CTAs.

## Stage 3 - Enforcement Decision

- If high-confidence ratio is stable and no-bookable failures are low:
  - decide whether to enforce `CALENDAR_REQUIRED_FOR_SYNC=true`
- If blocks-only drift alert triggers:
  - keep blocks fallback enabled
  - prioritize calendar reconnection for affected specialists

## Stage 4 - Regression Gate

- Run `calendar-booking-policy.test.js`.
- Run identity + checkout regression suite.
- Perform one inbound call and one chat booking end-to-end with payment verify.


---

<a id="care-delivery-video-consult"></a>

## Video Consult — Architecture, Env & Runbook

*Former path: `docs/architecture/care-delivery/VIDEO_CONSULT.md`*

**Last Updated:** April 8, 2026

Single reference for LiveKit video consult: flow, environment variables, and ops runbook.

---

## 1. Overview

Multimodal telehealth: LiveKit rooms + Python agents send transcript/vision/end_session to middleware. On **end_session**, a LangGraph runs: accumulate → retrieve_context (dual-source RAG + local) → human_review → store_fhir. Output: FHIR Communication, session metadata (including transcript and suggested codes), audit log.

---

## 2. Flow

```
LiveKit room → Python agents (transcript, vision_frame, end_session)
  → POST /api/video-consult/agent-events
  → LangGraph: accumulate → [end_session only] retrieve_context → human_review → store_fhir
  → FHIR Communication, video_consult_sessions.metadata, video_consult_ai_decisions
```

| Node | Trigger | Purpose |
|------|---------|---------|
| accumulate | All events | Merge transcript/frames into state, checkpoint |
| retrieve_context | end_session only | getCodeCandidatesDualSource (remote RAG + local, merge, validate) |
| human_review | end_session | HITL task when RAG error/skip |
| store_fhir | After human_review | FHIR Communication, audit |

**Events:** `transcript` / `vision_frame` → append only. `end_session` → full pipeline, then session ended (idempotent if already ended).

---

## 2.1 Vision capture state machine (event-driven)

Vision capture is task-driven (not continuous full-stream CV). Canonical events:
- `vision_capture_requested`
- `vision_capture_result`

State transitions per requested region:

```text
pending -> capturing -> passed
                   \-> retry_needed -> capturing
                   \-> failed_max_retries
```

Key policy behaviors:
- **Good enough**: if quality is fair but still clinically useful, mark `passed` with `provider_review_required=true`.
- **Give up/escalate**: after max retries, mark `failed_max_retries` and persist best evidence for manual clinician review.

Trigger contract (minimal):
- `vision_capture_requested`: `schema_version`, `session_id`, `requested_region`, `reason`, `attempt_index`, `trace_id`
- `vision_capture_result`: `schema_version`, `session_id`, `requested_region`, `detected_region`, `quality_issues[]`, `quality_band`, `provider_review_required`, `best_frame_url`, `candidate_frame_urls[]`, `region_confidence`, `quality_score`, `trace_id`

---

## 3. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LIVEKIT_URL` | Yes | - | WebSocket URL (e.g. `wss://your-project.livekit.cloud`) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Yes | - | From cloud.livekit.io |
| `VIDEO_CONSULT_AGENT_SECRET` | Prod | - | Agent-events auth; agents send `X-Video-Consult-Secret` or `Authorization: Bearer` |
| `VIDEO_CONSULT_MAX_FRAMES_PER_SESSION` | No | 90 | Max vision frames per session |
| `VIDEO_CONSULT_MAX_COST_PER_SESSION` | No | 10 | Max $ per session (throttling) |
| `VIDEO_CONSULT_ENABLE_VISION` | No | false | Enable vision/dermatology |
| `VIDEO_CONSULT_SLOW_NODE_MS` | No | 5000 | Slow-node log warning (ms) |
| `RAG_API_URL` | No | http://localhost:4000/api/rag | RAG proxy (middleware) |
| `COLAB_RAG_URL` | No | - | Backend RAG API; proxy forwards here. Restart after change. |
| `RAG_TIMEOUT` / `RAG_RETRIES` | No | 10000 / 2 | RAG client timeout and retries |
| `RAG_CIRCUIT_*` | No | 5 / 60000 / 30000 | Circuit breaker: failure threshold, window ms, reset ms |
| `DEEPGRAM_API_KEY` / `OPENAI_API_KEY` | Agent | - | STT (and vision) in Python agent |
| `BAA_ACKNOWLEDGED` | No | false | Set true when BHAs in place (LiveKit, STT vendors) |

**STT / language:** Flux = English. Nova-2/3 = multi-language. Coding (RAG + local) is English-oriented; for non-English, add translate-before-RAG (see HYBRID_ARCHITECTURE_OVERVIEW.md §6).

---

## 4. Runbook (Troubleshooting)

| Symptom | Fix |
|--------|-----|
| LiveKit "Invalid URL" / token failures | `LIVEKIT_URL` = `wss://...` (no trailing slash); restart middleware |
| 401 on agent-events | Set `VIDEO_CONSULT_AGENT_SECRET`; agents send header/Authorization |
| RAG_FALLBACK_EMPTY / RAG_ERROR_FALLBACK | Check `RAG_API_URL` reachable; `GET {RAG_API_URL}/health`; circuit breaker may be open (log: "RAG circuit open") |
| FHIR_ERROR | DB writable; verify patient_id/encounter_id (e.g. room `appt-{id}` → getAppointment) |
| BUDGET_EXCEEDED | Increase `VIDEO_CONSULT_MAX_COST_PER_SESSION` or disable vision |
| Capture stuck in `retry_needed` | Check worker health + frame ingress; verify `vision_capture_requested` and `vision_capture_result` event counts |
| `vision_capture_storage_rejected` | Confirm consent payload (`consent_acknowledged`) and secure signed HTTPS frame URLs |
| No checklist update in UI | Verify `GET /api/video-consult/vision/session/:sessionId` includes checklist and guidance payload |

Operational checks:
- Worker loop active (`vision-capture-worker`) and not erroring repeatedly.
- Feature flags enabled as intended: `VISION_FLAG_TRIGGERING`, `VISION_FLAG_ROI`, `VISION_FLAG_QUALITY`, `VISION_FLAG_PROVIDER_REVIEW`.
- Metrics trend: retries, worker errors, trigger->result latency, sampled frame count/cost.

**Cost:** Vision ~$0.01/frame; end_session ~$0.05. **Scaling:** Postgres checkpointer (`LANGGRAPH_USE_POSTGRES=true`) for multi-instance. **Cleanup:** `node scripts/cleanup-video-consult-data.js` or include in retention job.

---

## 5. Landing Try now (Skin & Care) vs this doc

The **marketing landing** (`littlelab-landing`) can open a **public** LiveKit room (`try-landing-*`) for camera preview + optional real-time session. That path uses **`POST /api/livekit/token` only** — it does **not** feed `video-consult` agent events, transcripts, or YOLO unless you add a separate agent/worker.

**Canonical detail:** [LANDING_TRY_NOW_LIVEKIT.md](./README.md#experience-landing-try-now-livekit).

---

## 6. Related

- [LANDING_TRY_NOW_LIVEKIT.md](./README.md#experience-landing-try-now-livekit) — Landing UI, preview → LiveKit handoff, debugging
- [HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md) — Voice vs Video vs PDF, shared RAG/codes
- [MEDIA_LAYER_ARCHITECTURE.md](./README.md#media-media-layer-architecture) — Media layer
- [LangGraph & LangSmith (middleware docs)](../middleware-platform/README.md#langgraph-langsmith) — Tracing (video consult runs, retrieve_context metadata)
- [VISION_UV_R_AND_D.md](./VISION_UV_R_AND_D.md) — UV imaging track (separate hardware/validation program)


---

<a id="commerce-agentic-checkout-file-map"></a>

## Agentic checkout — file map

*Former path: `docs/architecture/commerce/AGENTIC_CHECKOUT_FILE_MAP.md`*


Cross-surface feature: **landing / deep link → chat (Kelly) → server quote → Stripe pay**.

| Concern | Web | React Native | Middleware |
|--------|-----|--------------|------------|
| UI shell, tokens | `unified-dashboard/patients/checkout-chat.html` | `patient-app/app/checkout-chat.tsx` | — |
| Heroicons / assets | inline SVG + `unified-dashboard/assets/` | `patient-app/components/CheckoutHeroicons.tsx` | — |
| Copy deck (Kelly) | `unified-dashboard/copy/checkout-kelly.json` (+ `DEFAULT_KELLY_COPY` in HTML) | same APIs; tone from Kelly responses | `services/kelly-agent-service.js` prompts |
| Public catalog | fetch `GET /api/public/products` | same | `routes/public-products.js` (via server) |
| Commerce quote | `POST /api/public/commerce/quote` | same | `routes/public-commerce-quote.js` |
| Checkout chat turn | `POST /api/patient/checkout-chat/turn` + `/turn/stream` (SSE) | same | `server.js` handlers → `KellyAgentService` |
| LLM routing | — | — | `services/llm-router.js` (`call`, `callStreamWithDeltas`) |
| Checkout start | `POST /api/public/checkout/start` | same | `routes/public-checkout.js` |
| Analytics | `emitFunnelEvent` / `dataLayer` in HTML | `patient-app/lib/checkoutAnalytics.ts` | — |
| Static verify | — | — | `scripts/verify-agentic-checkout.cjs` (CI) |

**Related docs:** [SKIN_CARE_TOKENS_AND_ASSETS.md](./SKIN_CARE_TOKENS_AND_ASSETS.md), [PUBLIC_AGENTIC_CHECKOUT.md](./PUBLIC_AGENTIC_CHECKOUT.md) (if present), [STAGING_PRODUCT_VERIFICATION.md](../testing/README.md#staging-product-verification).


---

<a id="commerce-agentic-commerce-rollout-plan"></a>

## Agentic Commerce Rollout Plan

*Former path: `docs/architecture/commerce/AGENTIC_COMMERCE_ROLLOUT_PLAN.md`*

## Summary
This rollout introduces “agentic commerce” on the provider side:
- Provider UI can request product recommendations based on customer intent.
- Provider UI can create **draft orders** via `/api/orders`.
- Stripe webhooks reconcile order payment state from `pending_payment` to `paid`/`failed`.

## What Changed (Scope)
1. Provider UI
   - `unified-dashboard/business/products.html`: Agentic Commerce panel with recommendation + draft order creation.
   - `unified-dashboard/business/orders.html`: Order list, filters, and improved empty/error messaging.
2. Backend
   - `middleware-platform/routes/orders.js`: idempotent order creation + lifecycle defaults (`status=pending`, `payment_status=pending_payment`).
   - `middleware-platform/routes/stripe-webhook-handler.js`: reconcile merchant order payment on Stripe payment intent events.
3. Observability
   - Ops counters are emitted for order create/status/pay outcomes (see “Monitoring Signals”).

## Feature Flag
### UI-only toggle (safe)
To disable the provider Agentic Commerce UI without changing backend behavior:
- Query parameter: `?agentic=0`
- Local storage: `localStorage.setItem('agentic_commerce_ui','0')`

This hides the Agentic Commerce panel on `unified-dashboard/business/products.html`.

## Rollout Stages
### Stage 1: Enable on a single environment
1. Deploy backend changes first.
2. Rebuild and deploy the provider UI pages.
3. Confirm landing/provider routing still works at `/`.

### Stage 2: Validate funnel behavior (core checks)
1. Create an order from Agentic Commerce:
   - Use any existing product + enter an email.
   - Confirm order appears on `Orders` page.
2. Confirm payment lifecycle:
   - Orders should be created with `payment_status=pending_payment`.
   - On Stripe webhook events, payment reconciliation updates to `paid` or `failed`.
3. Confirm status update endpoint:
   - Verify `PUT /api/orders/:id/status` updates `status` only.

## Monitoring Signals
Watch these counters in `ops_counters`:
1. `merchant_order_create_attempt`
2. `merchant_order_create_success`
3. `merchant_order_create_failed`
4. `merchant_order_status_updated`
5. `merchant_order_payment_paid`
6. `merchant_order_payment_failed`

Operational log markers:
- Backend logs:
  - `📊 [agentic-commerce] order_created`
  - `📊 [agentic-commerce] order_status_updated`
  - `[StripeWebhook] merchant order paid`
  - `[StripeWebhook] merchant order payment failed`

### Alert Threshold Suggestions
- If `merchant_order_create_failed` spikes > 2x baseline, disable UI (`agentic=0`) and investigate inventory/product lookup failures.
- If `merchant_order_payment_failed` rises, validate webhook metadata mapping (`order_id`/`merchant_order_id`) and Stripe event processing.

## Manual QA Checklist
1. Provider UI
   - Agentic panel renders and can be hidden using `?agentic=0`.
   - Empty states:
     - No products -> “No Products Yet” prompt to add products.
     - No orders -> “Create one from Products → Agentic Commerce”.
2. Backend
   - Order creation requires:
     - `product_id`
     - `quantity > 0` integer
     - `customer_email`
   - Idempotency:
     - Repeat the same request with `Idempotency-Key` header should not double-create.
3. Webhook reconciliation (test or staging)
   - Create a draft order.
   - Trigger or simulate `payment_intent.succeeded`.
   - Confirm merchant order is updated to `payment_status=paid`.

## Fallback / Rollback
If issues occur:
1. Hide provider Agentic Commerce UI (disable via `?agentic=0` or local storage).
2. Backend payment reconciliation remains safe because:
   - Order creation is idempotent.
   - Webhook reconciliation is guarded by order existence lookup.
3. Continue operations through existing manual order flows (if any) while investigating.

## Owners
- Primary implementer: (current repo agent)
- Reviewer: (add your name/team)



---

<a id="commerce-public-agentic-checkout"></a>

## Public agentic checkout (catalog → quote → pay)

*Former path: `docs/architecture/commerce/PUBLIC_AGENTIC_CHECKOUT.md`*

Unauthenticated flows for retail products on the patient portal and LittleLab landing. **Charge amounts are never taken from the browser alone** for capture: they come from the product row in SQLite (`products.price`) × quantity, via `PaymentOrchestrator` or payment-link fallback.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/public/products` | Catalog list (scoped by `provider_id` / host when applicable). |
| `POST` | `/api/public/commerce/quote` | Creates `checkout_sessions` with `platform: commerce_quote`, `status: quoted`, and `session_data` (`kind`, `amount_cents`, `product_id`, `merchant_id`, `quantity`). Returns `quote_id`, `amount`, `expires_at`. |
| `POST` | `/api/public/checkout/start` | Ensures `customers` row; creates voice checkout + Stripe / link as today. Optional `quote_id` / `checkout_session_id` must match merchant, product, and non-expired quote; **409 `quote_stale`** if DB price no longer matches `amount_cents`. |

## Trusted vs display-only fields

- **Trusted (server):** `products.price`, inventory, merchant/product association, quote `amount_cents`, orchestrator totals.
- **Display-only / hints:** Any `amount` or `price` the client might send on unrelated legacy paths — public checkout **does not** use client body totals for capture.
- **Idempotency:** `Idempotency-Key` (or `idempotency_key` in body) with operation `public_checkout_start` stores successful JSON for 24h retries.

## Session lifecycle (`checkout_sessions`)

1. **`quoted`** — Created by `/api/public/commerce/quote`.
2. **`payment_pending`** — After `/api/public/checkout/start` successfully creates a checkout (voice checkout id stored in `session_data`).
3. **`paid`** — On Stripe `payment_intent.succeeded`, when PaymentIntent metadata includes `commerce_quote_id` (set for direct Stripe flows from `PaymentOrchestrator`), `stripe-webhook-handler` updates the matching `checkout_sessions` row to status **`paid`** and stores `stripe_payment_intent_id` in `session_data`.

## UI rollout

- **LittleLab landing:** `REACT_APP_CHAT_FIRST_CHECKOUT` (default: on). Set to `false` to hide the chat-first “Ask about this product” CTA and emphasize buy-now only for gradual rollout.

## References

- `middleware-platform/routes/public-commerce-quote.js`
- `middleware-platform/routes/public-checkout.js`
- `unified-dashboard/patients/checkout-chat.html`
- `middleware-platform/openapi.yaml` — tag **Public**
- Manual E2E (staging): `docs/testing/README.md#agentic-checkout-e2e-checklist`


---

<a id="database-database-schema-approach"></a>

## Database Schema Approach for Multi-Tenancy

*Former path: `docs/architecture/database/DATABASE_SCHEMA_APPROACH.md`*

## Your Question: "Are you suggesting event tenant schema?"

I think you're asking about the database schema strategy. Let me clarify the approach.

---

## Database Schema Options

There are **three main approaches** for multi-tenant databases:

### Option 1: Shared Database, Shared Schema (RECOMMENDED)

**What it means:**
- One database
- One set of tables
- All clinics share the same tables
- Each row has a `clinic_id` column to identify which clinic it belongs to

**Example:**
```sql
-- One table for ALL clinics
CREATE TABLE appointments (
  appointment_id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,  -- This identifies which clinic
  patient_name TEXT,
  date TEXT,
  time TEXT,
  ...
);

-- Clinic A's appointments
INSERT INTO appointments VALUES ('appt-1', 'clinic-001', 'John Doe', '2025-11-12', '10:00', ...);

-- Clinic B's appointments  
INSERT INTO appointments VALUES ('appt-2', 'clinic-002', 'Jane Smith', '2025-11-12', '2:00', ...);
```

**Query Example:**
```sql
-- Get ONLY Clinic A's appointments
SELECT * FROM appointments WHERE clinic_id = 'clinic-001';

-- Get ONLY Clinic B's appointments
SELECT * FROM appointments WHERE clinic_id = 'clinic-002';
```

**Pros:**
- ✅ Simple to implement
- ✅ Easy to maintain
- ✅ Efficient (one database)
- ✅ Easy to add new clinics
- ✅ Can query across clinics (for platform admin)

**Cons:**
- ⚠️ Must always filter by `clinic_id` (but we can enforce this in code)
- ⚠️ One clinic's bad query could affect others (mitigated with proper indexing)

---

### Option 2: Shared Database, Separate Schemas

**What it means:**
- One database
- Each clinic has their own schema (namespace)
- `clinicA.appointments`, `clinicB.appointments`, etc.

**Example:**
```sql
-- Clinic A's schema
CREATE SCHEMA clinicA;
CREATE TABLE clinicA.appointments (...);

-- Clinic B's schema
CREATE SCHEMA clinicB;
CREATE TABLE clinicB.appointments (...);
```

**Pros:**
- ✅ Better isolation
- ✅ Easier to drop a clinic (drop schema)

**Cons:**
- ❌ More complex
- ❌ Harder to query across clinics
- ❌ More database objects to manage
- ❌ SQLite doesn't support schemas well

---

### Option 3: Separate Databases

**What it means:**
- Each clinic has their own database file
- `clinicA.db`, `clinicB.db`, etc.

**Example:**
```javascript
// Clinic A's database
const clinicADb = new Database('clinicA.db');

// Clinic B's database
const clinicBDb = new Database('clinicB.db');
```

**Pros:**
- ✅ Maximum isolation
- ✅ Easy to backup/restore per clinic
- ✅ Can move clinic to different server

**Cons:**
- ❌ Very complex
- ❌ Hard to query across clinics
- ❌ More database connections
- ❌ Harder to maintain

---

## Recommendation: Option 1 (Shared Schema with clinic_id)

### Why This Approach?

1. **You're using SQLite** - SQLite doesn't handle schemas well
2. **Simplicity** - Easiest to implement and maintain
3. **Efficiency** - One database, one connection pool
4. **Scalability** - Can handle thousands of clinics
5. **Flexibility** - Easy to add cross-clinic features later

---

## How It Works

### Database Structure

```
One Database: middleware.db

Tables:
├── clinics (stores clinic info)
├── clinic_phone_numbers (maps phones to clinics)
├── fhir_patients (ALL patients, with clinic_id)
├── appointments (ALL appointments, with clinic_id)
├── insurance_claims (ALL claims, with clinic_id)
└── ... (all tables have clinic_id)
```

### Data Isolation

**Clinic A's data:**
```sql
SELECT * FROM appointments WHERE clinic_id = 'clinic-001';
```

**Clinic B's data:**
```sql
SELECT * FROM appointments WHERE clinic_id = 'clinic-002';
```

**They never mix!**

---

## Implementation Pattern

### All Database Functions Accept clinic_id

**Before (Single Tenant):**
```javascript
function getAppointments() {
  return db.prepare('SELECT * FROM appointments').all();
}
```

**After (Multi-Tenant):**
```javascript
function getAppointments(clinicId) {
  return db.prepare('SELECT * FROM appointments WHERE clinic_id = ?').all(clinicId);
}
```

### Enforce clinic_id in All Queries

**Pattern:**
```javascript
// Always include clinic_id in WHERE clause
const appointments = db.prepare(`
  SELECT * FROM appointments 
  WHERE clinic_id = ? AND status = 'scheduled'
`).all(clinicId);
```

---

## Security: Preventing Cross-Tenant Access

### Middleware to Enforce clinic_id

```javascript
// All API routes get clinic_id from authenticated user
app.get('/api/appointments', authenticateUser, (req, res) => {
  const clinicId = req.user.clinic_id;  // From authenticated session
  
  // Automatically scoped to user's clinic
  const appointments = db.getAppointments(clinicId);
  res.json(appointments);
});
```

### Database Helper Functions

```javascript
// Helper that ALWAYS includes clinic_id
db.getAppointments = function(clinicId) {
  return db.prepare(`
    SELECT * FROM appointments 
    WHERE clinic_id = ? 
    ORDER BY date DESC
  `).all(clinicId);
};

// Can't accidentally query without clinic_id
```

---

## Migration Strategy

### Step 1: Add clinic_id to Existing Data

```sql
-- Add clinic_id column (nullable initially)
ALTER TABLE appointments ADD COLUMN clinic_id TEXT;

-- For existing data, assign to default clinic
UPDATE appointments SET clinic_id = 'default-clinic' WHERE clinic_id IS NULL;

-- Make it required
-- (SQLite doesn't support NOT NULL on existing columns easily, 
--  so we'll enforce in application code)
```

### Step 2: Update All Queries

```javascript
// Old query
db.prepare('SELECT * FROM appointments').all();

// New query (always includes clinic_id)
db.prepare('SELECT * FROM appointments WHERE clinic_id = ?').all(clinicId);
```

### Step 3: Create New Tables with clinic_id

```sql
CREATE TABLE clinics (
  clinic_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ...
);

CREATE TABLE clinic_phone_numbers (
  phone_number TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  ...
);
```

---

## Example: Complete Multi-Tenant Query

### Scenario: Get Patient's Appointments

**Single Tenant (Current):**
```javascript
function getPatientAppointments(patientId) {
  return db.prepare(`
    SELECT * FROM appointments 
    WHERE patient_id = ?
  `).all(patientId);
}
```

**Multi-Tenant (New):**
```javascript
function getPatientAppointments(patientId, clinicId) {
  return db.prepare(`
    SELECT * FROM appointments 
    WHERE patient_id = ? 
      AND clinic_id = ?  -- Ensures we only get this clinic's appointments
  `).all(patientId, clinicId);
}
```

**Why both?**
- `patient_id` - Gets the patient's appointments
- `clinic_id` - Ensures they're from the correct clinic
- Prevents Clinic A from seeing Clinic B's patient data

---

## Summary

### What I'm Suggesting

**Shared Database + Shared Schema + clinic_id Column**

- ✅ One database (`middleware.db`)
- ✅ One set of tables
- ✅ `clinic_id` column in every table
- ✅ All queries filter by `clinic_id`
- ✅ Complete data isolation through filtering

### NOT Suggesting

- ❌ Separate databases per clinic
- ❌ Separate schemas per clinic
- ❌ Any approach that requires multiple database files

### Why This Works

1. **Simple** - Easy to understand and maintain
2. **Efficient** - One database connection
3. **Secure** - Data isolation through `clinic_id` filtering
4. **Scalable** - Can handle thousands of clinics
5. **SQLite-friendly** - Works perfectly with SQLite

---

## Visual Example

```
Database: middleware.db
┌─────────────────────────────────────────────────┐
│ appointments table                              │
├─────────────┬──────────────┬────────────────────┤
│ appt_id     │ clinic_id    │ patient_name       │
├─────────────┼──────────────┼────────────────────┤
│ appt-1      │ clinic-001   │ John Doe           │ ← Clinic A
│ appt-2      │ clinic-001   │ Jane Smith        │ ← Clinic A
│ appt-3      │ clinic-002   │ Bob Jones         │ ← Clinic B
│ appt-4      │ clinic-002   │ Alice Brown       │ ← Clinic B
└─────────────┴──────────────┴────────────────────┘

Query: SELECT * FROM appointments WHERE clinic_id = 'clinic-001'
Result: Only appt-1 and appt-2 (Clinic A's data)

Query: SELECT * FROM appointments WHERE clinic_id = 'clinic-002'  
Result: Only appt-3 and appt-4 (Clinic B's data)
```

**They're in the same table, but completely isolated by clinic_id!**



---

<a id="decisions-001-persistence-sqlite"></a>

## ADR 001: SQLite as default application database

*Former path: `docs/architecture/decisions/001-persistence-sqlite.md`*


## Status

Accepted (as implemented in `middleware-platform/database.js`).

## Context

The middleware needs embedded persistence for sessions, commerce, appointments, and related tables without mandatory external infrastructure for small deployments.

## Decision

Use **SQLite** (`better-sqlite3`) as the default store with migrations run at startup.

## Consequences

- **Pros:** Simple local and small-cloud deploys; few moving parts; fast iteration.
- **Cons:** Horizontal scaling and HA require a different store or replication strategy later; document migration paths (e.g. Postgres) when load or compliance demands it.


---

<a id="decisions-002-kelly-multi-llm"></a>

## ADR 002: Kelly uses a pluggable primary LLM (Anthropic vs Groq)

*Former path: `docs/architecture/decisions/002-kelly-multi-llm.md`*


## Status

Accepted (`middleware-platform/services/llm-router.js`).

## Context

Kelly must run in production with reliable tool calling while keeping cost and latency manageable. Different environments may prefer Claude or Groq.

## Decision

- **`KELLY_PRIMARY_PROVIDER`** selects the primary provider when both keys may exist.
- **Non-streaming** and **streaming** commerce paths both use **`call` / `callStreamWithDeltas`** so harness and SSE behave consistently.
- **Transient failures** may fall back between providers per router rules.

## Consequences

- Reviewers should treat **env vars** (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, model names) as part of the Kelly contract.
- See **`docs/development/README.md#kelly-env-and-debug`** for debug flags.


---

<a id="decisions-003-agentic-checkout-surfaces"></a>

## ADR 003: Agentic checkout spans static web, native app, and public APIs

*Former path: `docs/architecture/decisions/003-agentic-checkout-surfaces.md`*

## Status

Accepted.

## Context

Patients may start from **LittleLab landing**, **deep links**, or the **Expo app**. Checkout must feel chat-first while using **server-locked quotes** and **Stripe** for payment.

## Decision

- **Web:** `unified-dashboard/patients/checkout-chat.html` (Skin & Care tokens).
- **Native:** `patient-app/app/checkout-chat.tsx` calling the **same** middleware endpoints as web.
- **Backend:** public quote and checkout routes plus authenticated patient checkout-chat routes; Kelly tools for quote/checkout preparation.

## Consequences

- UI or copy changes may require **two clients** unless extracted to shared docs/API-only behavior.
- Use **`docs/architecture/README.md#commerce-agentic-checkout-file-map`** as the reviewer checklist for cross-surface changes.


---

<a id="decisions-readme"></a>

## Architecture Decision Records (ADR)

*Former path: `docs/architecture/decisions/README.md`*

**Last Updated:** April 9, 2026

Short, durable notes on **why** the platform chose certain approaches. Add a new file `NNN-short-title.md` when a decision is significant for reviewers and new contributors.

| ADR | Topic |
|-----|--------|
| [001-persistence-sqlite.md](./001-persistence-sqlite.md) | SQLite as default persistence |
| [002-kelly-multi-llm.md](./002-kelly-multi-llm.md) | Kelly LLM routing (Anthropic / Groq) |
| [003-agentic-checkout-surfaces.md](./003-agentic-checkout-surfaces.md) | Agentic checkout (web + RN + APIs) |


---

<a id="derm-patient-qa-phase-0-scope-and-metrics"></a>

## Phase 0 — Derm patient Q&A: scope, intent taxonomy, metrics, positioning

*Former path: `docs/architecture/derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md`*

This document implements **Phase 0** from `todos/pending/DERM_PATIENT_QA_REDDIT_PIPELINE_TODOS.md` (align and scope). It is the **product + evaluation contract** for the Reddit-informed patient Q&A pipeline (intent router → passage retrieval → grounded answers).

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

- Todo roadmap: `todos/pending/DERM_PATIENT_QA_REDDIT_PIPELINE_TODOS.md`
- RAG integration overview: `docs/architecture/README.md#overview-architecture-overview-and-colab-rag`
- Triage rules (reuse for red flags): `Knowledge/rules/triage-rules.json` (paths may vary)

---

*Document version: 1.0 — Phase 0 implementation.*


---

<a id="derm-patient-qa-phase-2-triage"></a>

## Phase 2 — Derm patient Q&A triage

*Former path: `docs/architecture/derm-patient-qa/PHASE_2_TRIAGE.md`*

Triage runs **before** heavy passage retrieval so intent, risk, and scheduling alignment shape what is retrieved and how answers are framed.

## Inputs

| Field | Required | Description |
| --- | --- | --- |
| `message` | Yes (for API) | Raw user text |
| `imageCaption` | No | Optional vision caption when a vision path exists |
| `structuredIntake` | No | OPQRST-like object; string values are joined as `key: value` lines and included in the combined text for red-flag and scheduling checks |
| `recentTurns` | No | `{ role, content }[]` passed to `checkBeforeScheduling` when present; otherwise derived from message + caption + intake |

Implementation: `middleware-platform/services/derm-patient-qa-triage.js` (`classifyDermPatientQA`).

## Rules and taxonomy

- Global patterns: `Knowledge/rules/triage-rules.json` via `triage-service` (`detectRedFlags`, `checkBeforeScheduling`).
- Derm-specific patterns: `Knowledge/rules/derm-patient-qa-intent-rules.json` (urgent skin, vague/clarify, routine/product, off-topic).

Outputs map to Phase 0 intent buckets (`intent`, `subkind`, `phase0_taxonomy`).

## Retrieval policy

`retrieval_policy` includes `passage_retrieval` (`full` | `minimal` | `none`), `top_k`, `specialty`, `scheduling_allowed`, `short_circuit_long_answer`, and `use_code_rag`. Urgent and clarify paths use minimal or no retrieval and short-circuit long differentials.

## Scheduling consistency

`scheduling.block_scheduling` reflects `checkBeforeScheduling` so “book” vs “urgent / block” does not contradict the existing triage gates.

## Logging

Each classification includes structured `_log` (intent, subkind, systemic urgency, scheduling blocked, rationale, timestamp). Stdout logging is enabled when `DERM_QA_TRIAGE_LOG=1` or `true`.

## API

`POST /api/patient/derm-qa/triage` — patient session + CSRF (cookie auth). Body: `{ message?, imageCaption?, structuredIntake?, recentTurns? }`. Returns the classifier output plus `disclaimers` and `request_id`.

## Tests

`middleware-platform/__tests__/derm-patient-qa-triage.test.js`


---

<a id="derm-patient-qa-phase-3-corpus-and-index"></a>

## Phase 3 — Derm patient education corpus & retrieval

*Former path: `docs/architecture/derm-patient-qa/PHASE_3_CORPUS_AND_INDEX.md`*

Patient-facing answers need **passage** retrieval, parallel to the **code-oriented** Colab `/retrieve` path used for ICD/CPT.

## P3.1 Corpus strategy

- **Content**: derm-first chunks (guidelines, approved briefs, vetted excerpts). Forums and raw social text are out of scope for the default index.
- **Versioning**: canonical manifest at [`Knowledge/corpus/derm-education/manifest.json`](../../../Knowledge/corpus/derm-education/manifest.json) (`corpus_id`, `version`, `owner`, chunking policy).
- **Ownership**: clinical content governance is a process responsibility (review cadence, source list); engineering owns the **index contract** and middleware client.

## P3.2 Index contract — `POST /retrieve_passages`

Implement on Colab (or a dedicated education service). Middleware calls **`RAG_EDUCATION_URL`** (see architecture overview); if unset, falls back to the same base as **`RAG_API_URL`** with path `/retrieve_passages`.

### Request (JSON)

| Field | Type | Description |
| --- | --- | --- |
| `query` | string | Primary retrieval string (may already include lay↔clinical expansion). |
| `specialty` | string | e.g. `dermatology`. |
| `region` | string | e.g. `US`. |
| `top_k` | number | Max passages. |
| `filters` | object | Optional: `pediatric`, `pregnancy`, `corpus_version`. |
| `hybrid` | object | Optional: `dense_query`, `bm25_terms[]` for backends that support hybrid retrieval. |
| `exclusion_terms` | string[] | Same spirit as code RAG. |

### Response (JSON)

| Field | Type | Description |
| --- | --- | --- |
| `passages` | array | Items: `id`, `text`, `source_id`, optional `source_title`, `specialty`, `score` (0–1), optional `metadata`. |
| `metadata` | object | Optional: `index`, `version`, `backend`. |

Empty `passages` is valid; callers fall back to non-RAG behavior.

## P3.3–P3.5 Middleware behavior

Implemented in `middleware-platform/services/layer2-rag/`:

- **Hybrid**: client sends `hybrid` when expansion yields extra terms; single-query backends can concatenate (see `patient-education-client.js`).
- **Query construction**: `patient-education-query.js` — expansions from `Knowledge/rules/derm-lay-clinical-expansions.json`; optional HyDE (guarded for vague/short queries).
- **Reranking**: `patient-education-passage-rerank.js` — lexical overlap rerank on query–passage pairs when the remote does not rerank.

## P3.6 Integration

- **Client**: `patient-education-client.js` — `retrievePatientEducationPassages`, `retrievePatientEducationForDermQA` (respects Phase 2 `retrieval_policy`).
- **Proxy**: `POST /api/rag/retrieve_passages` forwards to Colab `/api/retrieve_passages` or `/retrieve_passages`.
- **Env**: documented in [`ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`](../ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md) (`RAG_EDUCATION_URL` vs `RAG_API_URL`).


---

<a id="derm-patient-qa-phase-4-answer-and-safety"></a>

## Phase 4 — Answer generation and safety

*Former path: `docs/architecture/derm-patient-qa/PHASE_4_ANSWER_AND_SAFETY.md`*

Implements **prompt templates**, **grounding**, **citations**, **image disclaimers**, and **corpus content policy** hooks before any LLM call.

## P4.1 Prompt / template library

- File: [`Knowledge/prompts/derm-patient-qa-templates.json`](../../../Knowledge/prompts/derm-patient-qa-templates.json)
- Intent keys: `urgent`, `education`, `routine`, `off_topic`, `clarify` (from triage: urgent / education / routine / off_topic / needs clarification).
- Fixed sections: what evidence supports, limits, next step — embedded in each system template.

Loader: `middleware-platform/services/derm-patient-qa-answer.js` (`loadTemplates`, `composeFromParts`).

## P4.2 Grounding rules

- Module: `middleware-platform/services/derm-patient-qa-grounding.js`
- `assessPassageGrounding({ query, passages })` scores each passage by query token overlap; if **best score** is below `DERM_QA_GROUNDING_MIN_SCORE` (default `0.14`), composition uses **abstain** mode with `abstain_reason: evidence_mismatch` instead of implying unrelated excerpts apply.
- If retrieval returns no passages for education/routine (and retrieval was not skipped by policy), mode **`no_passages`** abstain.
- If all passages were dropped as spam, **`spam_filtered`**.

## P4.3 Citations

- `middleware-platform/services/derm-patient-qa-citations.js` — `buildCitationList`, `formatCitationsBlock`.
- API responses include **`citations`** (debug adds previews) and **`citations_for_ui`** (label, `source_id`, `id`) for Phase 8 UI.

## P4.4 Image path

- `middleware-platform/services/derm-patient-qa-image.js` — `CANNOT_DIAGNOSE_FROM_IMAGE`, `buildImageBlockForPrompt`, `buildRetrievalFacingText` (message + caption for retrieval alignment).

## P4.5 Content policy

- Rules: [`Knowledge/rules/derm-corpus-content-policy.json`](../../../Knowledge/rules/derm-corpus-content-policy.json)
- `middleware-platform/services/layer2-rag/patient-education-passage-rerank.js` — `rerankPassagesWithContentPolicy`: drop SEO-like chunks, boost `metadata` guideline tags.

## API

`POST /api/patient/derm-qa/compose` — patient session + CSRF. Body: `message`, optional `imageCaption`, `imagePresent`, `triage`, `retrieval`, `skip_retrieve`, `filters`, `debug` (verbose citations). Returns **`prompts.system`** / **`prompts.user`** for a downstream LLM, plus **`mode`**, **`grounding`**, **`citations_for_ui`**.

## Tests

`middleware-platform/__tests__/derm-patient-qa-phase4.test.js`


---

<a id="derm-patient-qa-phase-5-product-wiring"></a>

## Phase 5 — Product / API wiring

*Former path: `docs/architecture/derm-patient-qa/PHASE_5_PRODUCT_WIRING.md`*

## Feature flag

| Env | Meaning |
|--------|--------|
| **`DERM_EDUCATION_PIPELINE_ENABLED`** | `true` to enable the full pipeline, `/api/patient/derm-qa`, Step10 `inputs.derm_patient_qa`, and Kelly tool `run_derm_patient_qa`. |

Optional:

| Env | Meaning |
|--------|--------|
| **`DERM_QA_SKIP_LLM`** | `true` / `1` — run compose + retrieval only; no LLM answer (returns `answer_text: null`). |
| **`DERM_QA_LLM_MODEL`** | Groq model (default `llama-3.3-70b-versatile` when `GROQ_API_KEY` set). |
| **`DERM_QA_OPENAI_MODEL`** | OpenAI model when using `OPENAI_API_KEY` (default `gpt-4o-mini`). |

## Surfaces

### 1. `POST /api/patient/derm-qa`

Same auth as other patient `/api/patient/derm-qa/*` routes: `apiLimiter`, `requirePatientSession`, `requireCsrfForCookieAuth`, JSON body.

Body: same shape as compose (`message`, `imageCaption`, `imagePresent`, `triage`, `retrieval`, `skip_retrieve`, `filters`, `debug`, **`skip_llm`**).

Returns `runDermPatientQAPipeline` result: `compose`, `answer_text`, `llm_used`, `success`.

When the flag is off, returns **200** with `success: false` and `error: derm_education_pipeline_disabled` (client-friendly).

### 2. Step10 (`invokeStep10`)

If `inputs.derm_patient_qa` is an object and the pipeline flag is on, the graph **short-circuits** to the derm pipeline (runs even when `STEP10_GRAPH_ENABLED` is false). Payload fields mirror the HTTP body (`message`, `imageCaption` / `image_caption`, etc.).

Response includes `state.summary` (answer text), `derm_patient_qa` (full pipeline output), `stub: false`.

### 3. Kelly / voice (`run_derm_patient_qa`)

Registered when **`DERM_EDUCATION_PIPELINE_ENABLED`** is true at process start. `KellyToolExecutor` calls `runDermPatientQAPipeline` in-process. Result includes **`answer`** (alias of `answer_text`) for voice/chat consumption.

## Implementation

- `middleware-platform/services/derm-patient-qa-pipeline.js` — `isDermEducationPipelineEnabled`, `runDermPatientQAPipeline`
- `middleware-platform/server.js` — route registration
- `middleware-platform/services/step10-graph.js` — early branch in `invokeStep10`
- `middleware-platform/services/kelly-agent-service.js` — tool definition
- `middleware-platform/services/kelly-tool-executor.js` — `run_derm_patient_qa` case

## Production E2E — Kelly (same path as patient triage chat)

`POST /api/patient/triage/message` uses `KellyAgentService.processTurn` with **full** tool list when not in commerce-checkout mode. The derm tool is included only when `DERM_EDUCATION_PIPELINE_ENABLED=true` **at process startup** (restart middleware after changing env).

### In-process Kelly E2E (recommended for CI / dev)

Runs the **same** `processTurn` code as the server (no HTTP cookies):

```bash
cd middleware-platform
export DERM_EDUCATION_PIPELINE_ENABLED=true
export DERM_QA_E2E_LOG=1
# Optional: skip LLM inside derm pipeline only (Kelly still calls the primary LLM for tool turns)
export DERM_QA_SKIP_LLM=true
npm run test:e2e-kelly-derm
```

Requires at least one of `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`. Set `DEFAULT_CLINIC_ID` (or `CLINIC_ID=...`) to match your DB.

When the model calls `run_derm_patient_qa`, the executor logs one line:

`[DERM_QA_E2E] {"tool":"run_derm_patient_qa",...}`

Enable broader tool tracing with `DERM_QA_TOOL_LOG=true` (same log line).

### HTTP smoke (middleware must be listening)

```bash
MIDDLEWARE_BASE_URL=http://127.0.0.1:4000 npm run test:e2e-middleware-smoke
```

Expect `GET /health` OK and patient routes **401/403** without a session cookie.

Authenticated HTTP tests: obtain a patient session (e.g. demo login flow), then `POST /api/patient/triage/message` or `POST /api/patient/derm-qa` with the session cookie and CSRF as required by your deployment.


---

<a id="experience-landing-try-now-livekit"></a>

## Skin & Care landing — Try now & LiveKit

*Former path: `docs/architecture/experience/LANDING_TRY_NOW_LIVEKIT.md`*

**Last updated:** April 7, 2026

This doc describes the **marketing landing assistant** (`unified-dashboard/littlelab-landing`) and how **LiveKit** is used for optional live video. It complements **[VIDEO_CONSULT.md](./README.md#care-delivery-video-consult)** (provider/telehealth pipeline with agents, transcript, vision events).

---

## 1. Two different LiveKit surfaces

| Surface | Purpose | Backend beyond LiveKit |
|--------|---------|-------------------------|
| **Landing Try now** | Public demo: camera-first preview, small **3D orb** as “provider,” optional **LiveKit** room `try-landing-{sessionSlug}` | **Kelly** via `POST /api/public/landing-assistant/turn` (HTTP). **No** `video-consult` SSE unless you add an agent posting to that API. |
| **Provider / patient video** | Scheduled visit: `appt-…` / `case-…` rooms | **`/api/video-consult/*`**, Python agents, LangGraph on `end_session`, optional YOLO/vision **only** when agents send `vision_frame`. |

The landing app **does not** call `/api/video-consult`. YOLO and frame ingestion are **not** active for `try-landing-*` unless you deploy a worker that joins those rooms and posts agent events.

---

## 2. UX flow (voice page)

1. **Invite** — **Before you start** card (`LiveKitPanel`): camera + barcode scan are required for real scan results; primary CTA **Allow camera & start** (not chat-only).
2. **Browser permission** — `getUserMedia` (camera + mic) for immediate full-screen **mirrored** preview.
3. **Session** — Full-screen `<video>`; **orb** in a small PiP (bottom-right); header floats over video; bottom toolbar: **Scan**, **Voice (beta)** (mic; no wake word), **Upload**, **Video on/off**.
4. **LiveKit** — If `REACT_APP_API_BASE` points at middleware with `LIVEKIT_*` set, **`POST /api/livekit/token`** runs and the client connects with **`livekit-client`**. Preview tracks are **stopped only after** LiveKit’s camera track is attached (avoids a black flash).
5. **Without API base** — Local preview only; pill shows **Preview** and copy notes demo mode.

**Production API origin:** the public landing build uses split-domain routing — set `REACT_APP_API_BASE` to the middleware host (e.g. `https://api.myskinandcare.com`), not the Firebase Hosting UI origin. See [EDGE_ROUTING_CONFIGS.md](../deployment/EDGE_ROUTING_CONFIGS.md).

---

## 3. Key source files

| Area | Path |
|------|------|
| Shell / session | `littlelab-landing/src/AssistantExperience.jsx` |
| Voice UI + scan layout | `littlelab-landing/src/AssistantVoicePage.jsx` |
| LiveKit hook | `littlelab-landing/src/useLandingLiveKit.js` |
| Token API client | `littlelab-landing/src/landingLiveKitApi.js` |
| LiveKit toolbar / invite | `littlelab-landing/src/LiveKitPanel.jsx` |
| Orb (shared) | `littlelab-landing/src/AgentSphereCanvas.jsx`, `MagicPlasmaSphere.jsx` |
| Styles | `assistant-voice.css`, `assistant-livekit.css` |

---

## 4. Environment

| Variable | Where | Role |
|----------|--------|------|
| `REACT_APP_API_BASE` | CRA build | Middleware origin for Kelly **and** `/api/livekit/token`. Local e.g. `http://localhost:4000`; production split-domain e.g. `https://api.myskinandcare.com`. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Middleware `.env` | Issuing JWTs; see [VIDEO_CONSULT.md §3](./README.md#care-delivery-video-consult). |
| CSP | Static host | If you add `Content-Security-Policy`, allow `connect-src` to `wss://*.livekit.cloud` (see middleware `security.js` for API pages). |

---

## 5. Debugging

- **Black screen after connect:** Usually preview `MediaStream` was stopped before LiveKit attached. Fixed by stopping preview only when `getTrackPublication(Camera)` exists or on `LocalTrackPublished` (video). See `useLandingLiveKit.js`.
- **Token failures:** Middleware logs; enable verbose LiveKit route logs only in dev (see `routes/livekit.js` — gated in non-production unless `DEBUG_LIVEKIT=1`).
- **Kelly vs LiveKit:** Kelly turns are **HTTP**; LiveKit is **parallel** real-time A/V. They are not merged in one pipeline on the landing build.

---

## 5.1 Clinical safety language (must keep)

- Vision output in this flow is **assistive capture guidance**, not diagnosis.
- Region/quality checks (e.g., "show neck", "too blurry") are for **data quality and provider handoff**, not definitive clinical conclusions.
- When capture quality is only fair, mark for **provider review required** and continue with clinician judgment.

---

## 6. Related docs

- [VIDEO_CONSULT.md](./README.md#care-delivery-video-consult) — Provider video consult, agents, env, runbook  
- [HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md) — Voice vs video vs PDF  
- [Kelly phase prompts (middleware docs)](../middleware-platform/README.md#kelly-phase-prompt-architecture) — Landing Kelly / `kelly_flow`  
- [SKIN_CARE_TOKENS_AND_ASSETS.md](./SKIN_CARE_TOKENS_AND_ASSETS.md) — Brand tokens used by the landing shell  


---

<a id="experience-skin-care-tokens-and-assets"></a>

## Skin & Care — tokens, assets, and env (frontend)

*Former path: `docs/architecture/experience/SKIN_CARE_TOKENS_AND_ASSETS.md`*


## CSS tokens (web)

- **Canonical file:** `unified-dashboard/assets/css/skin-care-tokens.css`
- **Import rule for new HTML surfaces:** link global + tokens after charset/viewport, before page-specific CSS:

```html
<link rel="stylesheet" href="../assets/css/global.css" />
<link rel="stylesheet" href="../assets/css/skin-care-tokens.css" />
```

Use variables such as `var(--brand-accent)`, `var(--brand-cream)`, `var(--font-ui)` — do not introduce clinical blue for Skin & Care checkout.

## React Native parity

- **Constants:** `patient-app/constants/skinCareTokens.ts` mirrors the same hex values as `skin-care-tokens.css` for checkout and related native screens.

## Env vars (patient app)

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_BASE_URL` | Middleware base URL (required on device) |
| `EXPO_PUBLIC_MERCHANT_ID` | `provider_id` for public catalog / quote APIs |
| `EXPO_PUBLIC_DEMO_PRODUCT_ID` | Default product when opening checkout chat |
| `EXPO_PUBLIC_DEMO_PATIENT_EMAIL` | Optional login hint |

See `patient-app/.env.example` and `patient-app/config.ts`.

## Env vars (web / landing)

| Variable | Purpose |
|----------|---------|
| `REACT_APP_MERCHANT_ID` | Merchant id on littlelab-landing catalog |
| `REACT_APP_PATIENT_PORTAL_PREFIX` | Patient HTML base path |
| `REACT_APP_CHAT_FIRST_CHECKOUT` | `false` to hide Ask-first CTA |

## Brand assets

- Panda / favicon: `unified-dashboard/assets/images/` (e.g. `logo-panda.svg`, `favicon.svg`)
- Landing media: `unified-dashboard/littlelab-landing/public/images/`

## Related

- **[Landing Try now & LiveKit](./README.md#experience-landing-try-now-livekit)** — camera-first voice page, orb PiP, `REACT_APP_API_BASE`, LiveKit token flow


---

<a id="financial-fhir-native-rcm-mapping"></a>

## FHIR‑Native RCM Mapping (2026) — EMPI + EDI → FHIR

*Former path: `docs/architecture/financial/FHIR_NATIVE_RCM_MAPPING.md`*

**Last Updated:** April 6, 2026

Goal: make the Financial Intelligence Layer **FHIR‑first**. EDI (837/835) is an **ingest format**, not the internal data model. Normalize claims and remits into FHIR resources so agents operate on interoperable, longitudinal data.

---

## 1. Canonical identity: EMPI

**Why:** All RCM agents become unreliable without longitudinal identity across systems (FHIR, EDI, billing, wallets).

**Implementation (middleware DB):**

- `empi_persons` — canonical person id
- `empi_links` — links EMPI to source ids (`source_system`, `source_id`, `entity_type`, `confidence`)

Agents should prefer operating on `empi_id` and only fall back to `patient_id` when EMPI is not resolved.

---

## 2. FHIR resources to use (core set)

| Concern | FHIR resource | Notes |
|--------|---------------|------|
| Patient identity | `Patient` | Link to EMPI (`empi_links.source_system='fhir_patient'`) |
| Coverage | `Coverage` | Plan/payer membership |
| Claim submission | `Claim` | Represents the billed event |
| Payer adjudication | `ClaimResponse` | Response/line adjudication details |
| Remittance / payment explanation | `ExplanationOfBenefit` (EOB) | **Primary** resource for denials/adjustments/allowed/paid |
| Organizations | `Organization` | Payer and provider orgs |
| Payments | (internal) + EOB/ClaimResponse | FHIR does not standardize bank deposits; store deposits internally and link to EOB/Claim via references |

**Design rule:** RCM agents read/write *structured* data primarily from EOB + ClaimResponse, not raw EDI text.

---

## 3. EDI → FHIR normalization (high level)

### 3.1 837 (Claim) → FHIR `Claim`

Typical mapping:

- Subscriber/patient → `Patient`
- Payer → `Organization`
- Coverage details → `Coverage`
- Claim header + line items → `Claim.item[]`
- Diagnoses/procedures → `Claim.diagnosis[]`, `Claim.procedure[]` (use coding systems appropriately)

### 3.2 835 (Remittance) → FHIR `ExplanationOfBenefit` (+ `ClaimResponse`)

Typical mapping:

- Claim identifiers → `ExplanationOfBenefit.claim` reference or `identifier[]`
- Line adjudication amounts → `ExplanationOfBenefit.item[].adjudication[]`
- Reason/remark codes → represent in `adjudication.reason` and/or extensions
- Totals → `ExplanationOfBenefit.total[]` (allowed, paid, patient responsibility)

**Denials/adjustments:** represent as structured adjudication entries; keep the original reason code strings as `coding.code` plus display.

---

## 4. Template-driven mapping (recommended)

To avoid hard-coded transforms, define mapping templates per payer/source:

- **Input:** parsed EDI JSON (from HIPAAsuite/Cleo/etc.)
- **Output:** FHIR JSON (`Claim`, `ClaimResponse`, `ExplanationOfBenefit`)
- **Template engine:** Liquid/Handlebars (or equivalent)

This keeps payer quirks in config, not code.

---

## 5. Auditability & guardrails (2026)

All financial agents must write audit records:

- `ai_decisions_rcm` — agent_type, operation, input refs, snapshots, explanation, confidence, HITL status.

**Rule:** store an **audit rationale** (structured “why”) suitable for compliance, not patient-facing text. Use HITL thresholds for high-dollar or ambiguous cases.

---

## 6. What agents should consume

### Claims Specialist

- Consume: `ExplanationOfBenefit` + `ClaimResponse`
- Produce: denial classification + next-best-action (queue item), logged in `ai_decisions_rcm`

### Reconciliation Agent

- Consume: internal `deposits` + normalized EOB/ClaimResponse amounts
- Produce: match decisions, adjustments explanation; HITL for exceptions

### Patient Liaison

- Consume: longitudinal balances and coverage (EMPI-linked)
- Produce: patient-friendly explanations + payment plan proposals (HITL by policy)

---

## 7. Next build steps

1. Add `rcm_claims`, `rcm_remittances`, `rcm_deposits` tables (internal) and store parsed EDI payloads.
2. Implement EDI→FHIR mapper module (template-based) that outputs EOB/Claim/ClaimResponse.
3. Add a first “Claims Specialist v0” job: classify EOB reason codes into 5–10 buckets and log decisions to `ai_decisions_rcm`.



---

<a id="financial-financial-layer-architecture"></a>

## DocLittle Financial Layer - Detailed Architecture Document

*Former path: `docs/architecture/financial/FINANCIAL_LAYER_ARCHITECTURE.md`*

> **Note on Naming:** The codebase uses **Stedi** (not "Stepi") for the healthcare EDI API. Stedi is the insurance claims/eligibility provider.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Stedi API & Insurance Integration](#2-stedi-api--insurance-integration)
3. [Medical Billing, Codes & Knowledge Base](#3-medical-billing-codes--knowledge-base)
4. [End-to-End Financial Flow](#4-end-to-end-financial-flow)
5. [Database Schema](#5-database-schema)
6. [Voice Agent Integration](#6-voice-agent-integration)
7. [Component Reference](#7-component-reference)

---

## 1. Executive Overview

**FHIR‑native RCM (2026):** For the Financial Intelligence Layer roadmap (EMPI + EDI→FHIR normalization into `ExplanationOfBenefit`), see **[FHIR_NATIVE_RCM_MAPPING.md](./FHIR_NATIVE_RCM_MAPPING.md)**.

**Tiba Alignment:** The platform aligns with the Tiba Settlement Protocol for deterministic coding (c_i, q_i, φ_i, f^P_i, n_i), EOB line-item responsibility, modifier rules, prior-auth checks, OOP max, balance billing, and provider trust scores. Gaps and remediation: **[TIBA_AND_BILLING_TODO.md](./TIBA_AND_BILLING_TODO.md)**.

### 1.1 Purpose

The Financial Layer orchestrates healthcare revenue operations: insurance eligibility verification, claim submission, medical coding, EOB (Explanation of Benefits) calculation, invoicing, and patient payments. It integrates external APIs (Stedi for X12 EDI), internal knowledge bases (ICD-10, CPT, coding rules), and AI-assisted medical coding.

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           FINANCIAL LAYER ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   VOICE AGENT          HTTP API            SERVICES              EXTERNAL APIS            │
│   (Retell)              (server.js)                                                       │
│       │                      │                                                           │
│       │ collect_insurance    │  /voice/insurance/collect        ┌──────────────────┐      │
│       ├─────────────────────┼─────────────────────────────────►│  Stedi API       │      │
│       │                      │  /voice/insurance/check-eligibility  X12 270/271   │      │
│       │                      │  /voice/insurance/submit-claim      X12 837        │      │
│       │                      │                                    X12 276/277    │      │
│       │ get_patient_claims   │                                    /payers        │      │
│       │                      │                                 └────────┬─────────┘      │
│       │                      │                                          │                │
│       │                      │  ┌───────────────────────────────────────┘                │
│       │                      │  │                                                       │
│       │                      │  ▼                                                       │
│       │                      │  InsuranceService ──────► PayerCacheService              │
│       │                      │         │                                                 │
│       │                      │         ▼                                                 │
│       │                      │  EOBCalculationService ◄──── Eligibility + Claims         │
│       │                      │         │                                                 │
│       │                      │         ▼                                                 │
│       │                      │  InvoiceService ────────► PDFInvoiceService               │
│       │                      │                                                          │
│       │                      │  ┌────────────────────────────────────────────────────┐  │
│       │                      │  │  CODING PIPELINE (Knowledge Base)                   │  │
│       │                      │  │  PDFCodingService → CodingOrchestrator              │  │
│       │                      │  │       → MedicalCodingService (Groq)                 │  │
│       │                      │  │       → KnowledgeService                            │  │
│       │                      │  │  Knowledge: icd10_reference.json, simple-coding-rules│  │
│       │                      │  │  DB: cpt_codes, bulkUpsertCptCodes                   │  │
│       │                      │  └────────────────────────────────────────────────────┘  │
│       │                      │                                                          │
│       │                      │  FHIRService ───────────► Stripe Issuing (on-demand cards)│
│       │                      │  EmailService ──────────► Insurance billing emails        │
│       │                      │                                                          │
└───────┴──────────────────────┴──────────────────────────────────────────────────────────┘
```

### 1.3 Key Capabilities

| Capability | Description | Primary Service |
|------------|-------------|-----------------|
| Insurance Eligibility | X12 270/271 real-time verification | InsuranceService + Stedi |
| Claim Submission | X12 837 electronic claim submission | InsuranceService + Stedi |
| Claim Status | X12 276/277 status checks | InsuranceService + Stedi |
| Payer Lookup | Search/validate insurance payers | PayerCacheService + Stedi |
| Medical Coding | ICD-10/CPT from clinical notes | MedicalCodingService, KnowledgeService |
| EOB Calculation | Patient responsibility breakdown | EOBCalculationService |
| Invoice Generation | Patient invoices from claims | InvoiceService |
| Payment Cards | Stripe Issuing for copays/bills | FHIRService |

---

## 2. Stedi API & Insurance Integration

### 2.1 Stedi API Overview

**Provider:** Stedi (https://api.stedi.com)  
**Auth:** Bearer token via `STEDI_API_KEY`  
**Purpose:** Healthcare X12 EDI translation and payer connectivity for eligibility, claims, and status.

**Configuration:**
```javascript
// insurance-service.js
STEDI_API_BASE = process.env.STEDI_API_BASE || 'https://api.stedi.com'
STEDI_API_KEY = process.env.STEDI_API_KEY || 'test_1rRzTb0.Va9Tn88BB3fgPgttprqbrxQ1'
```

### 2.2 Stedi Endpoints Used

| Transaction | Stedi Endpoint | Purpose |
|-------------|----------------|---------|
| Eligibility (270/271) | `POST /x12/translate/270-to-edi` | Check patient insurance for a service |
| Claim (837) | `POST /x12/translate/837-to-edi` | Submit healthcare claim |
| Status (276/277) | `POST /x12/translate/276-to-edi` | Check claim status |
| Payers | `GET /payers`, `GET /payers/search` | List/search insurance payers |

**Docs:** `docs/integrations/README.md#stedi-api-stedi-api-endpoints`

### 2.3 InsuranceService

**File:** `middleware-platform/services/insurance-service.js`

| Method | Description | Stedi Usage |
|--------|-------------|-------------|
| `checkEligibility(eligibilityData)` | X12 270/271 eligibility check | Calls 270-to-edi, stores result in `eligibility_checks` |
| `submitClaim(claimData)` | X12 837 claim submission | Calls 837-to-edi, stores in `insurance_claims` |
| `checkClaimStatus(claimId)` | X12 276/277 status check | Calls 276-to-edi, updates claim status |
| `fetchPayers(options)` | List/search payers | GET /payers or /payers/search |
| `mapAppointmentTypeToCPT(type)` | Map appointment → CPT | Static mapping (90834, 90837, etc.) |
| `mapAppointmentTypeToICD10(type)` | Map appointment → ICD-10 | Static mapping (F41.9, Z00.4, etc.) |

**Behavior:**
- On Stedi API failure, falls back to simulation (mock responses for BCBS, AETNA, UHC).
- Idempotency: avoids duplicate claims via `idempotency_key`.
- On claim submit: creates Stripe Issuing card for patient responsibility when applicable.

### 2.4 PayerCacheService

**File:** `middleware-platform/services/payer-cache-service.js`

Caches insurance payers to reduce Stedi API usage:

1. **Lookup flow:** DB (`insurance_payers`) → Stedi → Cache result.
2. **Key methods:**
   - `searchPayer(searchTerm)` – search by name
   - `getPayerById(payerId)` – lookup by payer ID
   - `validatePatientInsurance(payerName, memberId)` – used by voice agent
   - `syncPayerList(limit)` – background sync from Stedi

**Fallback payers:** Cigna, Aetna, BCBS, UnitedHealthcare, Humana.

### 2.5 Voice Agent Insurance Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/voice/insurance/collect` | POST | Collect & verify insurance during call; runs eligibility |
| `/voice/insurance/check-eligibility` | POST | Check eligibility for appointment |
| `/voice/insurance/submit-claim` | POST | Submit claim for appointment |

### 2.6 Insurance Data Flow

```
Patient provides: name, DOB, member_id, payer_name
       │
       ▼
PayerCacheService.validatePatientInsurance(payerName, memberId)
       │
       ▼
InsuranceService.checkEligibility({ patientName, dateOfBirth, memberId, payerId, serviceCode, dateOfService })
       │
       ▼
Stedi: POST /x12/translate/270-to-edi
       │
       ▼
db.createEligibilityCheck({ eligible, copay_amount, allowed_amount, insurance_pays, deductible_total, ... })
       │
       ▼
Return: { eligible, copay, allowedAmount, insurancePays, planSummary, ... }
```

---

## 3. Medical Billing, Codes & Knowledge Base

### 3.1 Knowledge Base Structure

**Location:** `Knowledge/`

| Resource | Path | Description |
|----------|------|-------------|
| ICD-10 Reference | `Knowledge/ICD-10 Files/icd10_reference.json` | Fallback (~271 codes); primary: `icd10_codes` DB (~72K) |
| ICD-10 DB | `icd10_codes` table | From `scripts/import-icd10-codes.js`; source: icd10cm_codes_2020.txt |
| CPT DB | `cpt_codes` table | From `scripts/import-cpt-codes.js`; source: DHS addendum xlsx (~1.3K) |
| HCPCS DB | `hcpcs_codes` table | From `scripts/import-hcpcs-codes.js`; CMS HCPC2026 (~9K) |
| Simple Coding Rules | `Knowledge/rules/simple-coding-rules.json` | 30+ rules mapping clinical patterns → ICD-10 + CPT |
| Code-Pair Validation | `Knowledge/rules/code-pair-validation.json` | Incompatible ICD-10 + CPT pairs (e.g. psychiatric + surgical) |
| Triage Rules | `Knowledge/rules/triage-rules.json` | Emergent (9) + urgent (4) scenarios; rule-based triage |
| Medical Abbreviations | `Knowledge/ontology/medical-abbreviations.json` | 75+ abbreviations (SOB, HA, CP, DM, etc.) |
| Medical Entities | `Knowledge/ontology/medical-entities.json` | Symptom synonyms, severity indicators, temporal patterns |
| Extraction Patterns | `Knowledge/ontology/extraction-patterns.json` | Regex for symptoms, vitals, temporal, severity |
| Severity Indicators | `Knowledge/ontology/severity-indicators.json` | Pain scale (1–10), temporal (acute/subacute/chronic) |

### 3.2 Simple Coding Rules Format

Each rule has:
- `id` – rule identifier
- `match` – conditions: `appointment_type`, `duration_minutes`, `diagnosis_keywords`, `procedure_keywords`
- `icd10` – array of `{ code, description }`
- `cpt` – array of `{ code, description }`
- `rationale` – human-readable explanation

**Example rule (psychotherapy_45):**
```json
{
  "id": "psychotherapy_45",
  "match": {
    "appointment_type": "Outpatient psychotherapy",
    "duration_minutes": 45,
    "diagnosis_keywords": ["anxiety", "depression", "ptsd", "trauma", "stress"],
    "procedure_keywords": ["psychotherapy", "cbt", "therapy", "counseling"]
  },
  "icd10": [{"code": "F41.1", "description": "Generalized anxiety disorder"}],
  "cpt": [{"code": "90837", "description": "Psychotherapy, 60 minutes..."}]
}
```

### 3.3 KnowledgeService

**File:** `middleware-platform/services/knowledge-service.js`

| Method | Description |
|--------|-------------|
| `getCodeCandidates(clinicalNote, options)` | RAG: phrase extraction + keyword search → ICD-10, CPT, HCPCS candidates |
| `getCandidateCptCodes(note, options)` | Extract keywords, search `cpt_codes` DB, return ranked CPT candidates |
| `searchIcd10Codes(query, limit)` | DB or JSON fallback; phrase expansions for common terms |
| `searchHcpcsCodes(query, limit)` | Search `hcpcs_codes` for DME, supplies, modifiers |
| `validateCodesExist(codes)` | Verify codes exist in KB; reject hallucinated codes |
| `validateCodePair(icd10, cpt)` | Rule-based compatibility check; uses `code-pair-validation.json` |
| `matchSimpleRule({ appointmentType, durationMinutes, clinicalNote })` | Match first applicable rule from `simple-coding-rules.json` |
| `expandMedicalAbbreviations(text)` | Expand SOB, HA, CP, etc. from `medical-abbreviations.json` |
| `normalizeMedicalTerms(text)` | Map synonyms to canonical terms from `medical-entities.json` |
| `loadTriageRules()`, `loadMedicalEntities()`, `loadExtractionPatterns()` | Load ontology JSON; used internally |

**RAG pipeline:** `expandMedicalAbbreviations` → `normalizeMedicalTerms` → phrase extraction → phrase expansions (e.g. "well child" → "routine child health") → keyword search → rank by match count. Optional semantic search via `code_embeddings` when OPENAI_API_KEY set.

### 3.4 MedicalCodingService (AI-Assisted)

**File:** `middleware-platform/services/medical-coding-service.js`

Uses **Groq** (LLM) when `GROQ_API_KEY` is set; otherwise falls back to KnowledgeService.

| Method | Description |
|--------|-------------|
| `generateCodingSuggestion({ clinicalNote, encounterType, patientContext })` | Produces ICD-10 and CPT from clinical note using KnowledgeService candidates + Groq |

**Flow:**
1. Get CPT candidates via `knowledgeService.getCandidateCptCodes()`
2. Get ICD-10 reference via `knowledgeService.getReferenceIcdCodes()`
3. Build prompt with clinical note + reference codes
4. Call Groq (e.g. `llama-3.3-70b-versatile`)
5. Parse JSON: `{ icd10: [...], cpt: [...], rationale }`

### 3.5 CodingOrchestrator

**File:** `middleware-platform/services/coding-orchestrator.js`

Classifies encounters and routes to the right coding path:

| Band | Condition | Coding Source |
|------|-----------|---------------|
| SIMPLE | `matchSimpleRule()` returns a match | Simple rules (no LLM) |
| MODERATE | Few keywords (≤12) | KnowledgeService candidates only |
| COMPLEX | Otherwise | Groq (MedicalCodingService) |

```javascript
// runCodingPipeline(encounter, options = {})
// options: { payerId, dateOfService }
// Returns: { band, icd10, cpt, rationale, details }
// Per CPT (Tiba spec): { code, description, confidence, quantity, allowed_amount?, in_network? }
// confidence = min(φ^NLP_i, φ^rule_i, φ^historical_i); capped by φ_auth_cap when prior auth required but not on file
```

### 3.6 PDFCodingService

**File:** `middleware-platform/services/pdf-coding-service.js`

End-to-end PDF → codes + pricing:

1. `extractTextFromPDF(pdfBuffer)` – pdf-parse
2. `runCodingPipeline(encounter, { payerId, dateOfService })` – CodingOrchestrator (passes payerId for f^P_i, n_i)
3. `getCPTPricing(cptCodes, options)` – **FeeScheduleService** when `payerId` in options; else `CPT_PRICING_FALLBACK`
4. `calculateTotalCharge()` – sum of CPT prices

**Pricing:** Uses `FeeScheduleService.getAllowedAmountsForCodes(payerId, cptCodes)` when `processPDF` receives `payerId` (e.g. from `/api/pdf-coding/process` body). Fallback: 90837 $150, 90834 $120, 99213 $100, etc.

### 3.7 DiagnosisCodeMapper

**File:** `middleware-platform/services/diagnosis-code-mapper.js`

Maps ICD-10 → typical CPT and charges:

- `getCPTCodesForDiagnosis(diagnosisCode)` – e.g. S83.541 (ACL tear) → 99213, 73721, 97110, 97112
- `generateServiceLineItemsFromDiagnoses(diagnosisCodes, options)` – builds line items for EOB/invoices

Used when claims have diagnosis codes but no service line items.

### 3.8 CPT Code Storage

**Database:** `cpt_codes` table

- `code` (PK), `description`, `category`, `subcategory`, `is_new`
- Populated via `bulkUpsertCptCodes(items)` from external sources (e.g. DHS Excel)
- Search: `searchCptCodes(query, limit)`

---

## 4. End-to-End Financial Flow

### 4.1 Eligibility → Claim → EOB → Invoice

```
1. ELIGIBILITY
   Voice/API → InsuranceService.checkEligibility()
   → Stedi 270-to-edi → eligibility_checks

2. CLAIM SUBMISSION
   API → InsuranceService.submitClaim()
   → Stedi 837-to-edi → insurance_claims
   → FHIRService.createCardForBill/copay (if patient owes)

3. EOB CALCULATION
   EOBCalculationService.calculateEOBFromClaim(claim, eligibility, claimDetails)
   → Line items from claim/response_data OR DiagnosisCodeMapper
   → calculateEOB({ lineItems, eligibility })
   → Totals: amountBilled, allowedAmount, planPaid, deductible, copay, coinsurance, balanceBilling, whatYouOwe
   → Per-line: inNetwork (from fee_schedules); balance billing (1-n_i)×max(0, f_i-a_i) for out-of-network
   → OOP max cap: when oop_met + patient responsibility > oop_max, excess shifts to plan (Tiba spec 3.2)

4. SETTLEMENT (Tiba spec 4)
   SettlementService.getSettlementDecision(claim, codingResult, eob)
   → Φ = α×Φ_weighted + (1-α)×Φ_min
   → S(R_plan, Φ): full (Φ≥0.95), partial (0.70≤Φ<0.95), hold (Φ<0.70)
   → preAdjudication.settlementDecision: { decision, amount, escrowRemainder, aggregateConfidence }

5. INVOICE
   InvoiceService.createInvoiceFromClaim(claimId)
   → EOBCalculationService (patient responsibility)
   → db.createInvoice() + addInvoiceItem()
```

### 4.2 Confidence-Weighted Settlement (Tiba Spec 4)

**File:** `middleware-platform/services/settlement-service.js`

| Formula | Description |
|---------|-------------|
| Φ_weighted | Σ(φ_i × r^plan_i) / R_plan |
| Φ_min | min(φ_1, ..., φ_n) |
| Φ | α × Φ_weighted + (1 − α) × Φ_min |
| S(R_plan, Φ) | full if Φ ≥ θ_high; partial if θ_low ≤ Φ < θ_high; hold if Φ < θ_low |

**Config (env):** `THETA_HIGH=0.95`, `THETA_LOW=0.70`, `ALPHA=0.7`

**Decisions:** `full` (release R_plan), `partial` (release R_plan × Φ), `hold` (release 0, escrow R_plan)

### 4.3 Post-Adjudication Reconciliation (Tiba Spec 4.3, 3.4)

**File:** `middleware-platform/services/reconciliation-service.js`

When claim status becomes approved/paid: Δ_plan = final_R_plan − real_time_R_plan. Tolerance: auto-reconcile when |Δ| ≤ $10 or |Δ|/allowed ≤ 5%; else flag for manual. Actions: `release_additional`, `recover`, `flag_release`, `flag_recover`. `real_time_plan_paid` stored when pre-adjudication runs; `finalPlanPaid` from 277/835 or `paymentAmount`.

### 4.4 PDF → Claim Flow

```
1. PDF upload (pdf-coding.html)
2. PDFCodingService.processPDF()
   → extractTextFromPDF → runCodingPipeline → getCPTPricing
3. User creates claim with extracted codes
4. Claim stored with response_data: { coding, pricing }
5. EOB calculated from pricing.breakdown
6. User generates invoice
```

---

## 5. Database Schema

### 5.1 Insurance Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `eligibility_checks` | id, patient_id, member_id, payer_id, service_code, eligible, copay_amount, allowed_amount, insurance_pays, deductible_total, deductible_remaining, coinsurance_percent, oop_max, oop_met, plan_summary | Stedi 270/271 results (oop_max/oop_met per Tiba spec) |
| `insurance_claims` | id, appointment_id, patient_id, member_id, payer_id, service_code, diagnosis_code, total_amount, copay_amount, insurance_amount, status, real_time_plan_paid, payment_amount, response_data, ... | X12 837 claims |
| `insurance_payers` | id, payer_id, payer_name, aliases, supported_transactions | Payer cache from Stedi |
| `patient_insurance` | id, patient_id, payer_id, member_id, group_number, plan_name, is_primary, is_verified | Patient insurance records |
| `code_acceptance_rates` | payer_id, cpt_code, acceptance_count, denial_count, last_updated | Tiba φ^historical (Phase 4) |

### 5.1a Historical & Prior Auth (Tiba Phase 4)

**CodeAcceptanceService** tracks (payer, CPT) acceptance/denial from claim outcomes. `getHistoricalConfidence(payerId, cptCode)` returns acceptance rate; used as φ^historical_i. Call `trackCodeOutcome(claimId, codes, status, payerId)` when claim status becomes approved/denied.

**Prior auth:** `Knowledge/rules/prior-auth-rules.json` lists CPTs requiring prior auth. When `requiresPriorAuth(cpt)` and auth not on file, confidence is capped at φ_auth_cap (default 0.6). Pass `authOnFile: true` in `runCodingPipeline` options when auth is on file.

### 5.2 Billing Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `invoices` | id, claim_id, patient_id, invoice_number, status, amount, due_date | Patient invoices |
| `invoice_items` | id, invoice_id, service_date, description, cpt_code, icd_code, quantity, unit_price, total_price | Invoice line items |
| `invoice_payments` | id, invoice_id, payment_date, amount, payment_method, reference_number | Payment tracking |

### 5.3 Coding Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `icd10_codes` | code, description, category, billable | ICD-10 reference (~72K) |
| `cpt_codes` | code, description, category, subcategory, is_new | CPT code reference |
| `hcpcs_codes` | code, long_desc, short_desc, type | HCPCS reference (~9K) |
| `fee_schedules` | payer_id, cpt_code, allowed_amount | Payer-specific pricing |
| `coding_decisions` | call_id, proposed_icd10, proposed_cpt, validation_status | Audit trail for validate_code_pair |
| `voice_call_states` | call_id, current_stage, state_data | Medical coding state machine |
| `voice_conversation_memory` | call_id, turn_number, role, content | Conversation history |

---

## 6. Voice Agent Integration

### 6.1 Retell Functions (Financial-Related)

| Function | Handler | Description |
|----------|---------|-------------|
| `collect_insurance` | `handleCollectInsurance` | Calls `/voice/insurance/collect`, validates payer, runs eligibility |
| `get_patient_claims` | `handleGetPatientClaims` | Fetches claims for patient |
| `create_appointment_checkout` | `handleCreateAppointmentCheckout` | Creates checkout with copay; may create Stripe card |

### 6.2 Medical Coding Voice Tools (Real-Time During Calls)

| Function | Handler | Description |
|----------|---------|-------------|
| `search_icd10_codes` | `handleSearchIcd10Codes` | Look up ICD-10 by symptom/condition/code |
| `search_cpt_codes` | `handleSearchCptCodes` | Look up CPT by procedure |
| `search_hcpcs_codes` | `handleSearchHcpcsCodes` | Look up HCPCS (DME, supplies, modifiers) |
| `suggest_codes_from_symptoms` | `handleSuggestCodesFromSymptoms` | Get ICD-10 + CPT from patient description; returns `validated_pairs` |
| `extract_medical_text` | `handleExtractMedicalText` | Extract { symptoms, vitals, severity, temporal } from utterance |
| `assess_urgency` | `handleAssessUrgency` | Triage: EMERGENT / URGENT / ROUTINE (rule-based from `triage-rules.json`) |
| `validate_code_pair` | `handleValidateCodePair` | Check ICD-10 + CPT compatibility; logs to `coding_decisions` |
| `check_payer_guidelines` | `handleCheckPayerGuidelines` | Check if payer has fee schedule |
| `get_code_pricing` | `handleGetCodePricing` | Get allowed amounts for CPT codes from fee schedule |

All invoke `knowledge-service`, `triage-service`, `medical-text-extraction-service`, or `fee-schedule-service`. State transitions tracked by `coding-state-service`.

### 6.3 Medical Coding State Flow

```
INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING
```

| Stage | Trigger |
|-------|---------|
| INTAKE | Call start, scheduling tools |
| EXTRACTION | `extract_medical_text`, first user utterance |
| TRIAGE | `assess_urgency` |
| CODING | `suggest_codes_from_symptoms`, `search_icd10_codes`, `search_cpt_codes`, `search_hcpcs_codes` |
| VALIDATION | `validate_code_pair`, `check_payer_guidelines` |
| BILLING | `collect_insurance`, `get_code_pricing` |

**Persistence:** `voice_call_states`, `voice_conversation_memory`, `agent_state_snapshots`, `coding_decisions` (30-day retention). See `docs/architecture/README.md#voice-agent-state-flow`.

**Coding flow sequence:**

```
Patient (Voice)          Retell Agent          retell-websocket          Services
       │                       │                        │                    │
       │  "I have diabetes     │                        │                    │
       │   and need a checkup" │                        │                    │
       │─────────────────────>│                        │                    │
       │                       │  assess_urgency()      │                    │
       │                       │──────────────────────>│ triage-service     │
       │                       │<──────────────────────│ ROUTINE            │
       │                       │                        │                    │
       │                       │  search_icd10_codes()  │  knowledge-service │
       │                       │──────────────────────>│──────────────────>│
       │                       │<──────────────────────│<──────────────────│
       │                       │  search_cpt_codes()    │                    │
       │                       │──────────────────────>│──────────────────>│
       │                       │<──────────────────────│<──────────────────│
       │                       │                        │                    │
       │                       │  validate_code_pair()  │  code-pair rules   │
       │                       │──────────────────────>│  coding_decisions  │
       │                       │<──────────────────────│                    │
       │                       │                        │                    │
       │                       │  get_code_pricing()    │  fee-schedule-     │
       │                       │──────────────────────>│  service           │
       │                       │<──────────────────────│                    │
       │                       │                        │                    │
       │  "I've found codes..."│                        │                    │
       │<─────────────────────│                        │                    │
```

### 6.4 Triage Service (Red-Flag Detection)

**File:** `services/triage-service.js`

- `detectRedFlags(text)` – Rule-based from `Knowledge/rules/triage-rules.json`; returns EMERGENT (9 rules: chest pain, stroke, meningitis, seizure, anaphylaxis, etc.), URGENT (4 rules: high fever, fracture, severe pain), or ROUTINE
- `checkBeforeScheduling(conversationHistory)` – Blocks scheduling when EMERGENT
- Used by `assess_urgency` and `handleScheduleAppointment`

### 6.5 Collect Insurance Flow

```
Voice: collect_insurance({ patient_name, member_id, payer_name, date_of_birth, ... })
       │
       ▼
retell-websocket.js: handleCollectInsurance()
       │
       ▼
POST /voice/insurance/collect
       │
       ├─ PayerCacheService.validatePatientInsurance(payerName, memberId)
       ├─ FHIRService.findOrCreatePatient()
       ├─ InsuranceService.checkEligibility()
       ├─ db.upsertPatientInsurance()
       ▼
Return: { success, patient_id, coverage: { eligible, copay, ... } }
```

### 6.6 Stripe Issuing (On-Demand Cards)

Cards are created only when needed:

- On claim submit when patient owes (copay or post-insurance)
- On appointment checkout with copay/patient responsibility
- Only for patients with insurance (`patient_insurance`)

---

## 7. Component Reference

### 7.1 Services

| Service | Path | Dependencies |
|---------|------|--------------|
| InsuranceService | `services/insurance-service.js` | axios, db, Stedi |
| PayerCacheService | `services/payer-cache-service.js` | db, InsuranceService |
| EOBCalculationService | `services/eob-calculation-service.js` | FeeScheduleService |
| SettlementService | `services/settlement-service.js` | — |
| ReconciliationService | `services/reconciliation-service.js` | — |
| CodeAcceptanceService | `services/code-acceptance-service.js` | db, cache |
| FeeScheduleService | `services/fee-schedule-service.js` | db |
| AdjudicationService | `services/adjudication-service.js` | FeeScheduleService, EOBCalculationService, SettlementService, db |
| InvoiceService | `services/invoice-service.js` | db, EOBCalculationService |
| KnowledgeService | `services/knowledge-service.js` | fs, path, db |
| MedicalCodingService | `services/medical-coding-service.js` | Groq, KnowledgeService |
| CodingOrchestrator | `services/coding-orchestrator.js` | KnowledgeService, MedicalCodingService |
| PDFCodingService | `services/pdf-coding-service.js` | pdf-parse, CodingOrchestrator, FeeScheduleService, db |
| DiagnosisCodeMapper | `services/diagnosis-code-mapper.js` | Category-based ICD→CPT (E11, I10, J45, etc.) |
| MedicalTextExtractionService | `services/medical-text-extraction-service.js` | extraction-patterns, medical-entities, severity-indicators |
| ProviderDirectoryService | `services/provider-directory-service.js` | InsuranceService |

### 7.2 Environment Variables

| Variable | Purpose |
|----------|---------|
| `STEDI_API_BASE` | Stedi API base URL |
| `STEDI_API_KEY` | Stedi Bearer token |
| `GROQ_API_KEY` | Groq API key for medical coding |
| `GROQ_MODEL` | Model (default: llama-3.3-70b-versatile) |

### 7.3 Phase 3: Fee Schedules & Real-Time Adjudication

When payer fee schedule data is available:

1. **Fee schedules** (`fee_schedules` table) – Payer-specific allowed amounts per CPT code. Ingest via:
   - `GET /api/admin/fee-schedules?payerId=BCBS` – List
   - `POST /api/admin/fee-schedules` – Single upsert
   - `POST /api/admin/fee-schedules/bulk` – Bulk upload
   - Optional seed: `middleware-platform/scripts/seed-fee-schedules.js` (BCBS, Aetna, UHC sample rates)

2. **EOB calculation** – Uses `FeeScheduleService.resolveAllowedAmount()` when `payerId` + CPT exist; otherwise 85%/70% fallback.

3. **Pre-adjudication** – `GET /api/claims/:claimId/pre-adjudicate` runs real-time adjudication (claim + eligibility + fee schedule → EOB + pre-adjudication estimate).

4. **AdjudicationService** – `runAdjudication()`, `preAdjudicateClaim()` for estimates before claim submission.

### 7.4 Related Documentation

- `docs/architecture/README.md#voice-agent-voice-agent-todo-and-status` – **Voice agent todo & status** (close backend–agent gap)
- `docs/architecture/README.md#voice-agent-multi-model-reality-check` – Voice vs PDF cost (98% vs 2%), multi-model deprioritized
- `docs/architecture/README.md#voice-agent-state-flow` – Medical coding state flow
- `docs/architecture/README.md#voice-agent-runbook` – Imports, evaluation, rules, troubleshooting
- `docs/architecture/voice-agent/MEDICAL_CODING_AGENT_TODO.md` – Implementation roadmap
- `docs/integrations/README.md#stedi-api-stedi-api-endpoints` – Stedi endpoints
- `docs/integrations/README.md#stedi-api-stedi-vs-uhc-fhir-data-comparison` – Stedi vs UHC FHIR
- `docs/integrations/README.md#stripe-issuing-stripe-issuing` – Card creation rules (on-demand section)
- `docs/knowledge-base/README.md` – Knowledge base architecture
- `docs/development/README.md#invoice-billing-implementation-summary` – Invoice implementation

---

*Document generated from codebase analysis. Last updated: February 2026.*


---

<a id="financial-impact-community-token-strategy"></a>

## Impact Community and Token Strategy

*Former path: `docs/architecture/financial/IMPACT_COMMUNITY_TOKEN_STRATEGY.md`*


## Purpose

This document reviews the proposed "impact-first" token plan and adapts it to the current DocLittle stack.  
Goal: build a trusted community around measurable social impact while reducing legal, technical, and reputational risk.

This is a product and infrastructure strategy document, not legal advice.

## Current Baseline (What Exists Today)

- **Core platform:** middleware APIs, voice/chat assistant, patient/provider workflows, receipts, and analytics.
- **Payment rails:** strong hybrid baseline with traditional rails (Stripe/card flows) plus wallet/USDC/Circle components.
- **Operations reality:** meaningful progress, but still in hardening phase for public-scale financial products.
- **Conclusion:** foundation is credible, but tokenization should follow reliability and compliance milestones, not lead them.

### Newly Implemented (Phase 0 Progress)

- Payment mutation idempotency has been implemented across primary payment endpoints, including conflict handling and cached replay behavior.
- Duplicate-charge guardrails are now enforced before settlement in both payment processing entry points.
- Webhook protection has been strengthened:
  - Stripe signature verification + replay/staleness checks.
  - Circle signature verification + replay/staleness checks.
  - Twilio signature verification + replay guards on voice/SMS/status callbacks.
- Anti-sybil controls are live with risk scoring and enforcement, now applied to payment and initial community/impact surfaces.
- Human-review operations are now present:
  - risk appeal intake,
  - persisted fraud review queue,
  - admin assignment/resolution routes,
  - SLA breach monitoring with operational signals.
- Fraud response playbook is documented and aligned with the implemented controls.

## Review of the Proposed 3-Stage Path

## Stage 1: Payment Alpha (Infrastructure)

This is directionally correct and should be mandatory before any token launch.

### Recommended adjustments

- Scope Alpha around **proof of safe value movement**, not growth claims.
- Define measurable SLOs:
  - successful transfer rate
  - reconciliation completeness
  - mean time to detect/resolve payment exceptions
  - fraud/abuse incident rate
- Add public incident process and transparent postmortems before asking community capital.

## Stage 2: Regulated Community Raise (Reg CF or Similar)

This is the most practical public path for non-accredited participation.

### Recommended adjustments

- Treat fundraising as **mission financing**, not token marketing.
- Use experienced counsel for offering structure and disclosures.
- Prepare audited financials and ongoing reporting readiness before launch.
- Keep investor messaging grounded in execution metrics, not price appreciation promises.

## Stage 3: Impact Token (Utility)

Token can be powerful if utility is real and measurable.

### Recommended adjustments

- Launch token only after:
  - operational reliability benchmarks are met
  - compliance controls are in place
  - community governance is functioning off-chain first
- Design token utility around platform behavior:
  - care access discounts
  - governance over impact allocation
  - staking for quality assurance and anti-spam participation
- Avoid direct "token equals stock" framing unless under explicit securities structure.

## Why This Order Makes Sense for DocLittle

- Current stack already supports impact tracking and payment telemetry.
- Conventional payment rails let you serve users immediately while wallet rails mature.
- A token launched too early creates asymmetric downside: legal risk, trust loss, and ops overload.
- A trust-first sequence lets the token become a multiplier, not a liability.

## Recommended 12-Month Roadmap

## Phase 0 (0-90 days): Reliability and Trust Foundation

- Harden payment lifecycle controls:
  - idempotency and duplicate-charge prevention checks
  - webhook replay handling
  - deterministic ledger reconciliation jobs
- Build an **Impact Ledger v1** (off-chain):
  - event model for outcomes and aid allocation
  - auditable event history with immutable hashes
  - public read-only dashboard with delayed privacy-safe aggregates
- Governance prep:
  - community charter
  - contribution rules
  - anti-sybil policies

## Phase 1 (90-180 days): Community and Compliance Readiness

- Run private community cohorts with non-transferable impact points.
- Establish external attestation partners for impact claims.
- Complete readiness package for regulated raise:
  - legal entity and governance docs (PBC can align mission)
  - audited financial statements where required
  - standardized risk disclosures
- Publish transparent KPI dashboard:
  - treated users
  - care outcome proxies
  - aid deployed
  - payment reliability

## Phase 2 (180-270 days): Regulated Public Raise

- Execute Reg CF (or chosen compliant path) on approved rails.
- Offer simple instruments (for example, SAFE with clear terms) rather than complex hybrid constructs at first launch.
- Cap dilution per round in board policy and disclose governance rights clearly.

## Phase 3 (270-365 days): Utility Token Launch

- Ship token utility features only after legal signoff and abuse testing:
  - governance voting for impact budget allocation
  - fee/discount utility in care journeys
  - staking-based participation quality gates
- Keep emissions conservative and milestone-based.
- Run phased rollout:
  - closed beta
  - controlled public beta
  - wider release after monitoring stability and abuse vectors

## Token Design Principles (Moat-Focused, Impact-Safe)

- **Utility first, speculation second:** tie value to platform participation and measurable outcomes.
- **Verifiable impact:** every rewardable action must be auditable and resistant to gaming.
- **Progressive decentralization:** start with strong guardrails; decentralize governance as controls mature.
- **Treasury discipline:** transparent treasury policy, vesting, and spending constraints.
- **Mission integrity:** codify social outcomes in governance and reporting, not only in marketing.

## KPIs to Gate Each Milestone

- Payment success and reconciliation accuracy
- Fraud loss rate and dispute resolution time
- Community retention and contribution quality
- Verified impact events per active member
- Cost per validated impact unit
- Regulatory and audit readiness checkpoints

## Risks and Mitigations

- **Regulatory risk:** use compliance-first sequencing and external counsel review.
- **Trust risk:** publish transparent metrics and incident history.
- **Gaming risk:** attestation + anti-sybil + delayed rewards + slashing policy.
- **Liquidity/speculation risk:** conservative emissions, vesting, and utility-bound incentives.
- **Execution risk:** do not run fundraising, token launch, and major infra rewrite simultaneously.

## Recommended Positioning

"DocLittle is building an impact network for care delivery.  
We measure real outcomes, route support transparently, and reward verified contribution.  
Financial upside follows trusted impact and product utility, not hype."

## Immediate Next Steps (Next 30 Days)

- Finalize Impact Ledger schema and dashboard scope.
- Define payment reliability SLOs and on-call escalation policy.
- Draft compliance workstream with external legal counsel.
- Launch community pilot with non-transferable impact points.
- Publish quarterly impact and reliability report template.


---

<a id="financial-provider-trust-probation"></a>

## Provider Trust Score Probationary Period

*Former path: `docs/architecture/financial/PROVIDER_TRUST_PROBATION.md`*

## Overview

New providers start with a default trust score of `τ = 0.5` (configurable via `DEFAULT_PROVIDER_TRUST_SCORE`). This creates an intentional probationary period where all claims require manual review.

## How It Works

**Formula**: `Φ_effective = Φ × τ_provider`

**Example**:
- New provider submits claim with coding confidence `Φ = 0.95`
- Trust score `τ = 0.5` (default for new providers)
- Effective confidence: `Φ_effective = 0.95 × 0.5 = 0.475`
- Settlement threshold: `THETA_LOW = 0.70`
- Result: `0.475 < 0.70` → **Decision: HOLD** (requires manual review)

## Provider Onboarding Communication

**Must communicate to new providers**:

> "Your first N claims will require manual review to establish trust scores. This is a standard security measure to prevent fraud. Once your trust score is established (typically after 10-20 successful claims), claims will be auto-approved when coding confidence is high."

## Trust Score Establishment

Trust scores are updated when:
- Claims are approved/paid → trust score increases
- Claims are denied → trust score decreases
- Fraud flags → trust score decreases significantly

**Typical timeline**: 10-20 successful claims before trust score reaches `τ ≥ 0.8` (enabling auto-approval for high-confidence claims).

## Configuration

```bash
# Default trust score for new providers (0.0 - 1.0)
DEFAULT_PROVIDER_TRUST_SCORE=0.5

# Minimum trust score for auto-approval (optional)
MIN_TRUST_FOR_AUTO_APPROVAL=0.8
```

## FAQ

**Q: Why not start at τ = 1.0?**  
A: Prevents new providers from gaming early claims to build trust artificially.

**Q: How long does probation last?**  
A: Until trust score reaches threshold (typically 10-20 successful claims).

**Q: Can we skip probation for verified providers?**  
A: Yes - manually set `trust_score = 0.8` in `provider_trust_metrics` table for pre-verified providers.

---

*Last Updated: February 2026*


---

<a id="financial-static-records-audit"></a>

## Static Records Audit

*Former path: `docs/architecture/financial/STATIC_RECORDS_AUDIT.md`*

This document lists all hardcoded/static records found in the codebase (frontend and backend, including admin).

## 🔴 CRITICAL: Hardcoded Merchant ID

**Location**: Multiple files  
**Issue**: Hardcoded merchant ID `d10794ff-ca11-4e6f-93e9-560162b4f884` used as fallback

### Backend Files:

1. **`middleware-platform/server.js`** (Line 1210)
   ```javascript
   merchant_id: process.env.MERCHANT_ID || 'd10794ff-ca11-4e6f-93e9-560162b4f884'
   ```

2. **`middleware-platform/server.js`** (Line 1373)
   ```javascript
   merchant_id: process.env.MERCHANT_ID || 'd10794ff-ca11-4e6f-93e9-560162b4f884'
   ```

3. **`middleware-platform/server.js`** (Line 1669)
   ```javascript
   const merchantId = args.merchant_id || 'd10794ff-ca11-4e6f-93e9-560162b4f884';
   ```

4. **`middleware-platform/server.js`** (Line 1672-1681)
   ```javascript
   // Creates default merchant with hardcoded values
   db.createMerchant({
     id: merchantId,
     name: 'DocLittle Default Merchant',
     api_key: 'default-api-key',
     api_url: 'https://api.example.com',
     webhook_url: null,
     enabled_platforms: JSON.stringify(['voice']),
     status: 'active'
   });
   ```

5. **`middleware-platform/server.js`** (Line 3253)
   ```javascript
   merchant_id: 'd10794ff-ca11-4e6f-93e9-560162b4f884',
   ```

6. **`middleware-platform/webhooks/retell-websocket.js`** (Line 519)
   ```javascript
   merchant_id: functionArgs.merchant_id || 'd10794ff-ca11-4e6f-93e9-560162b4f884',
   ```

7. **`middleware-platform/webhooks/retell-websocket.js`** (Line 555)
   ```javascript
   merchant_id: 'd10794ff-ca11-4e6f-93e9-560162b4f884',
   ```

8. **`middleware-platform/webhooks/retell-websocket.js`** (Line 692)
   ```javascript
   let merchantId = functionArgs.merchant_id || 'd10794ff-ca11-4e6f-93e9-560162b4f884';
   ```

9. **`middleware-platform/webhooks/retell-websocket.js`** (Line 806)
   ```javascript
   let merchantId = 'd10794ff-ca11-4e6f-93e9-560162b4f884';
   ```

**Recommendation**: 
- Remove all hardcoded merchant IDs
- Use tenant context middleware to resolve merchant
- Return error if merchant cannot be determined (no fallback)

---

## 🟡 MEDIUM: Hardcoded Default Subdomain

**Location**: `middleware-platform/utils/constants.js` (Line 10)
```javascript
DEFAULT_SUBDOMAIN: process.env.DEFAULT_TENANT_SUBDOMAIN || 'akin-dunbar',
```

**Used in**: 
- `middleware-platform/routes/customer-agent.js` (getTenantType function)

**Recommendation**: 
- Mark as DEPRECATED (already done)
- Remove usage in favor of tenant resolution
- Keep only for backward compatibility during migration

---

## 🟡 MEDIUM: Hardcoded Test Patient Data

**Location**: `middleware-platform/server.js` (Lines 3690-3723)
```javascript
const testPatients = [
  {
    firstName: 'Sarah',
    lastName: 'Johnson',
    phone: '+18622307479',
    email: 'sarah.johnson@example.com',
    birthDate: '1985-05-20',
    memberId: 'TEST81941',
    payerId: 'AETNA',
    // ... more fields
  },
  {
    firstName: 'Michael',
    lastName: 'Williams',
    phone: '+15551234567',
    email: 'michael.williams@example.com',
    // ... more fields
  }
];
```

**Endpoint**: `POST /api/admin/patients/seed-test`

**Recommendation**: 
- Keep for testing/development
- Add environment check (only allow in dev/staging)
- Consider moving to separate seed script

---

## 🟢 LOW: Hardcoded Default States (Admin Dashboard)

**Location**: `unified-dashboard/admin/index.html` (Lines 1688-1691)
```javascript
window.selectedStates = [
  { value: 'US,NJ', text: 'New Jersey' },
  { value: 'US,NY', text: 'New York' }
];
```

**Purpose**: Default states for lead search in admin dashboard

**Recommendation**: 
- This is acceptable as UI default
- Consider making configurable via admin settings
- Not a data integrity issue

---

## 🟢 LOW: Mock Trend Data (Business Dashboard)

**Location**: `unified-dashboard/business/business-dashboard.html` (Lines 2314-2316)
```javascript
// Update trend indicators (mock data for now - can be calculated from historical data)
document.getElementById('revenueTrend').textContent = '+11%';
document.getElementById('aovTrend').textContent = '+2.7%';
```

**Recommendation**: 
- Replace with actual historical data calculation
- Low priority - UI enhancement

---

## Summary

### Critical Issues (Must Fix):
1. **Hardcoded Merchant ID** - 9 instances across backend
   - **Impact**: Multi-tenant isolation broken
   - **Priority**: HIGH
   - **Action**: Remove all fallbacks, use tenant context

### Medium Issues (Should Fix):
2. **Default Subdomain** - 1 instance (already deprecated)
   - **Impact**: Backward compatibility only
   - **Priority**: MEDIUM
   - **Action**: Remove after migration complete

3. **Test Patient Data** - 1 endpoint
   - **Impact**: Development/testing only
   - **Priority**: MEDIUM
   - **Action**: Add environment guard

### Low Issues (Nice to Have):
4. **Default States** - Admin UI default
   - **Impact**: None (UI convenience)
   - **Priority**: LOW

5. **Mock Trend Data** - Business dashboard
   - **Impact**: None (UI placeholder)
   - **Priority**: LOW

---

## Action Plan

1. **Phase 1 (Critical)**: Remove all hardcoded merchant ID fallbacks
   - Update `server.js` (5 instances)
   - Update `retell-websocket.js` (4 instances)
   - Ensure tenant context middleware is used everywhere
   - Test multi-tenant scenarios

2. **Phase 2 (Medium)**: Clean up deprecated defaults
   - Remove `DEFAULT_SUBDOMAIN` usage
   - Add environment guard to test patient seeding

3. **Phase 3 (Low)**: UI improvements
   - Replace mock trend data with real calculations
   - Make default states configurable



---

<a id="financial-stuck-escrow-recovery"></a>

## Stuck Escrow Recovery System

*Former path: `docs/architecture/financial/STUCK_ESCROW_RECOVERY.md`*

## Overview

The stuck escrow recovery system prevents unrecoverable financial loss when the triple jump settlement flow fails mid-execution. It uses a state machine with durable checkpoints and idempotency keys to enable safe retries.

## Problem Statement

**Scenario**: Transfer 1 (Insurer → Escrow) succeeds, but Transfer 2 (Escrow → Provider) fails or the process crashes before recording it.

**Risk**: Funds are stuck in escrow wallet with no automatic recovery path. USDC transfers are irreversible, so manual intervention is required.

## Solution Architecture

### 1. State Machine (`settlement_attempts` table)

Tracks the state of all three transfers for each settlement attempt:

```sql
CREATE TABLE settlement_attempts (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE,
  total_approved REAL NOT NULL,
  provider_amount REAL NOT NULL,
  revenue_amount REAL NOT NULL,
  transfer_1_status TEXT DEFAULT 'pending', -- pending, completed, failed
  transfer_2_status TEXT DEFAULT 'pending',
  transfer_3_status TEXT DEFAULT 'pending',
  transfer_1_circle_id TEXT, -- Circle transaction ID
  transfer_2_circle_id TEXT,
  transfer_3_circle_id TEXT,
  recovery_attempts INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Key Design**:
- State written BEFORE each transfer executes (durable checkpoint)
- State updated AFTER each transfer completes
- If process crashes, state persists → recoverable

### 2. Idempotency Keys

**Format**: `${claimId}-transfer-{1|2|3}`

**Example**: `CLAIM-12345-transfer-2`

**Protection**: If Transfer 2 succeeds but response is lost, retry with same idempotency key returns the original transfer (no double-payment).

**Critical Insight**: Most "stuck escrows" aren't failed transfers—they're succeeded transfers where the process crashed before recording success.

### 3. Recovery Service (`escrow-recovery-service.js`)

**Functions**:
- `recoverStuckEscrow(claimId)` - Recover single claim
- `recoverAllStuckEscrows(olderThanHours)` - Batch recovery

**Recovery Logic**:
1. Find settlement attempt where `transfer_1_status = 'completed'` and `transfer_2_status != 'completed'`
2. Retry Transfer 2 using idempotency key `${claimId}-transfer-2`
3. If Transfer 2 succeeds, retry Transfer 3 using `${claimId}-transfer-3`
4. Update state after each successful retry

### 4. Recovery Endpoints

**Manual Recovery**:
```
POST /api/admin/recover-stuck-escrow/:claimId
```

**Batch Recovery** (for scheduled jobs):
```
POST /api/admin/recover-all-stuck-escrows?olderThanHours=1
```

### 5. Scheduled Job

**Script**: `scripts/scheduled-recover-escrow.js`

**Recommended Schedule**: Every 15 minutes

**Cron Example**:
```bash
*/15 * * * * cd /path/to/middleware-platform && node scripts/scheduled-recover-escrow.js 1
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  executeInstantSettlement(claimId)                          │
├─────────────────────────────────────────────────────────────┤
│  1. Create settlement_attempts record (state: all pending)  │
│  2. Transfer 1: Insurer → Escrow                            │
│     → Update state: transfer_1_status = 'completed'         │
│  3. Transfer 2 & 3: Escrow → Provider + Revenue (parallel) │
│     → Update state: transfer_2_status, transfer_3_status   │
│  4. If any fail → State persists for recovery               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    [Process Crash?]
                              │
                    ┌──────────┴──────────┐
                    │                     │
              [No Crash]            [Crash]
                    │                     │
                    ▼                     ▼
            [All Complete]    [State Persists]
                                    │
                                    ▼
                          recoverStuckEscrow()
                                    │
                                    ▼
                    [Retry with idempotency keys]
                                    │
                                    ▼
                            [Recovery Complete]
```

## Usage Examples

### Manual Recovery

```bash
curl -X POST "http://localhost:4000/api/admin/recover-stuck-escrow/CLAIM-12345"
```

**Response**:
```json
{
  "success": true,
  "claimId": "CLAIM-12345",
  "message": "Settlement fully recovered",
  "recovered": [
    {
      "transfer": "transfer_2",
      "amount": 194.0,
      "circleTransferId": "circle-tx-abc123"
    },
    {
      "transfer": "transfer_3",
      "amount": 6.0,
      "circleTransferId": "circle-tx-def456"
    }
  ]
}
```

### Scheduled Recovery

```bash
# Run recovery job
node scripts/scheduled-recover-escrow.js 1

# Output:
# 🔍 Starting scheduled escrow recovery (older than 1 hour(s))...
# ✅ Recovery complete:
#    Found: 2 stuck escrows
#    Recovered: 2
```

## Safety Guarantees

1. **Idempotency**: Same idempotency key = same transfer (no double-payment)
2. **State Persistence**: State written before transfers → crash-safe
3. **Recovery Window**: Only recovers attempts older than 1 hour (prevents premature retries)
4. **Audit Trail**: All recovery attempts logged in `settlement_attempts.recovery_attempts`

## Monitoring

**Query stuck escrows**:
```sql
SELECT claim_id, transfer_1_status, transfer_2_status, transfer_3_status, created_at
FROM settlement_attempts
WHERE transfer_1_status = 'completed'
  AND transfer_2_status != 'completed'
  AND datetime(created_at) < datetime('now', '-1 hours');
```

**Alert Threshold**: If stuck escrows > 5, investigate immediately.

## Testing

**Test stuck escrow scenario**:
1. Start settlement for a claim
2. Kill process after Transfer 1 completes but before Transfer 2
3. Wait 1 hour
4. Run recovery job
5. Verify Transfer 2 & 3 complete

**Test idempotency**:
1. Run settlement (Transfer 2 succeeds)
2. Manually set `transfer_2_status = 'pending'` in database
3. Run recovery
4. Verify no double-payment (Circle returns original transfer)

---

*Last Updated: February 2026*


---

<a id="financial-tiba-and-billing-todo"></a>

## Tiba & Billing — Consolidated Todo

*Former path: `docs/architecture/financial/TIBA_AND_BILLING_TODO.md`*

**Last Updated:** April 6, 2026

Merged from: Tiba Gap Analysis, Gap Remediation Todo, Tiba Detailed Todo, Backend Billing Review.

---

## 1. Tiba Alignment Summary

The Tiba Settlement Protocol defines deterministic coding (c_i, q_i, φ_i, f^P_i, n_i), EOB line-item responsibility, confidence-weighted settlement, and provider trust scores. See [TIBA_FINANCIAL_LAYER_GAP_ANALYSIS](#2-gap-analysis) (archived into this doc).

**Current State:**
- ✅ Coding returns codes, confidence; modifier rules, prior-auth checks exist
- ✅ EOB: deductible, copay, coinsurance, OOP max, balance billing
- ✅ Provider trust metrics table, settlement state persistence
- ⚠️ Historical confidence (φ^historical), post-adjudication reconciliation pending
- ❌ Escrow layer out of scope (Tiba uses blockchain; we use Stripe/Circle)

---

## 2. Gap Analysis (Tiba Spec Mapping)

### 2.1 Deterministic Coding (C_deterministic)

| Field | Status | Gap |
|-------|--------|-----|
| c_i (CPT) | ✅ | None |
| q_i (quantity) | ✅ | Default 1 per line |
| φ_i (confidence) | ✅ | min(NLP, rule); historical pending |
| f^P_i (payer allowed) | ✅ | When payerId at coding time |
| n_i (network) | ✅ | fee_schedules.in_network |
| Modifiers (-25, -59, -51) | ✅ | modifier-rules.json, getRequiredModifiers |
| Prior auth | ✅ | requiresPriorAuth, φ_auth_cap |

### 2.2 EOB (Section 3)

| Step | Status | Gap |
|------|--------|-----|
| Allowed amount, deductible, copay | ✅ | None |
| OOP max cap | ✅ | oop_max, oop_met in eligibility |
| Balance billing (OON) | ✅ | (1-n_i)×(f_i-a_i) |
| Temporal consistency (Δ_i) | ⚠️ | Post-adjudication comparison pending |

### 2.3 Settlement (Section 4)

| Component | Status | Gap |
|-----------|--------|-----|
| Φ_weighted, Φ_min, α | ⚠️ | MIN_CODING_CONFIDENCE only; add θ_high, θ_low |
| S(R_plan, Φ) | ⚠️ | Partial; full/partial/hold logic |
| Post-adjudication Δ_plan | ❌ | When 835/277 returns |
| Provider trust τ | ✅ | provider_trust_metrics |

---

## 3. Code Remediation (Priority Order)

### CRITICAL: Modifier Handling
- **Files:** knowledge-service.js, medical-coding-service.js, coding-orchestrator.js, eob-calculation-service.js
- **Logic:** E/M + procedure → -25; distinct procedures → -59; multiple surgery → -51
- **φ^modifier_i:** 0.60 if required modifier missing

### CRITICAL: Provider Trust Integration
- **DB:** provider_trust_metrics (npi, trust_score, denial_rate, etc.)
- **Files:** code-acceptance-service, settlement-service, adjudication-service
- **Logic:** Φ_effective = Φ × τ_provider; use in getSettlementDecision

### CRITICAL: Settlement State Persistence
- **DB:** insurance_claims + settlement_state, settlement_aggregate_confidence, settlement_amount_released, settlement_decision
- **Files:** adjudication-service, server.js claim APIs

### HIGH: NecessityRules Version Control
- **File:** code-pair-validation.json — add version, effective_date
- **knowledge-service:** getRuleVersionForDate, getRuleHash

### HIGH: Encounter Time Validation
- **File:** time-based-cpt-rules.json — CPT → min duration
- **knowledge-service:** validateCptDuration, computeTimeConfidence

---

## 4. Tiba Phase Checklist (Condensed)

### Phase 1: EOB & Benefits ✅
- [x] oop_max, oop_met in eligibility_checks
- [x] Stedi 271 parsing for OOP
- [x] OOP max cap in calculateEOB
- [x] Balance billing for out-of-network

### Phase 2: Deterministic Coding ✅
- [x] runCodingPipeline accepts payerId
- [x] q_i, f^P_i, n_i in output
- [x] computeRuleConfidence, φ^rule_i

### Phase 3+: Settlement, Reconciliation
- [ ] θ_high, θ_low config; S(R_plan, Φ) full logic
- [ ] Post-adjudication Δ_plan reconciliation
- [ ] Unit tests for EOB edge cases

---

## 5. Backend Billing API Review

### Tenant Scoping Issues

| Endpoint | Issue | Recommendation |
|----------|-------|----------------|
| `GET /api/admin/billing/eob` | No tenant filter | Add `GET /api/customer/billing/eob`; filter by merchant_id |
| `GET /api/invoices` | Scope check needed | Confirm getInvoices applies merchant filter |
| `GET /api/fhir/Patient` | Global resource | Filter by merchant_id if multi-tenant |
| `GET /api/claims/:id` | Verify ownership | Ensure claim belongs to requester's merchant |

### Route Inventory
- `/api/usage-monitor` — Credits, billing
- `/api/invoices` — invoices-clinic.js
- `/api/claims/*` — server.js inline
- `/api/pdf-coding` — PDF processing
- `/api/customer/billing` — Usage, checkout
- `/api/admin/billing` — EOB list (scope fix needed)

---

## 6. Implementation Order

1. **Modifier + Trust + Settlement** (CRITICAL block)
2. **NecessityRules + Time validation** (HIGH)
3. **Backend billing tenant scoping** (Security)
4. **Post-adjudication reconciliation** (Phase 4)


---

<a id="healthcare-healthcare-assessment"></a>

## Healthcare Use Case Assessment

*Former path: `docs/architecture/healthcare/HEALTHCARE_ASSESSMENT.md`*

## Overview
Deep assessment of Voice Agent, FHIR, Payment, EPIC, Stedi, Circle, and Stripe integrations for healthcare appointment booking and billing.

---

## 1. Voice Agent (Retell) Assessment

### ✅ **What's Working**

1. **Appointment Endpoints Exist**:
   - `POST /voice/appointments/schedule` ✅
   - `POST /voice/appointments/confirm` ✅
   - `POST /voice/appointments/cancel` ✅
   - `POST /voice/appointments/reschedule` ✅
   - `POST /voice/appointments/available-slots` ✅
   - `POST /voice/appointments/search` ✅

2. **Checkout/Payment Endpoints**:
   - `POST /voice/appointments/checkout` ✅
   - `POST /voice/checkout/verify` ✅

3. **Insurance Endpoints**:
   - `POST /voice/insurance/collect` ✅
   - `POST /voice/insurance/check-eligibility` ✅
   - `POST /voice/insurance/submit-claim` ✅

### ❌ **Critical Issues**

#### **Issue 1: Missing Retell LLM WebSocket Handler**
- **Problem**: Retell requires an LLM WebSocket endpoint (`/webhook/retell/llm`) to handle function calls
- **Current State**: Only event webhooks exist (`/webhook/retell/events`, `/webhook/retell/end-of-call`)
- **Impact**: Voice agent CANNOT call functions (schedule_appointment, collect_insurance, etc.)
- **Location**: `configure-retell.js` references `llm_websocket_url` but handler doesn't exist
- **Fix Needed**: Implement WebSocket handler in `webhooks/retell-websocket.js` or create new handler

#### **Issue 2: Retell Functions Not Exposed**
- **Problem**: The voice agent prompt (`tiba-voice-agent-prompt.md`) defines functions, but they're not exposed to Retell
- **Functions Needed**:
  - `collect_insurance` → `POST /voice/insurance/collect`
  - `schedule_appointment` → `POST /voice/appointments/schedule`
  - `get_available_slots` → `POST /voice/appointments/available-slots`
  - `search_appointments` → `POST /voice/appointments/search`
  - `confirm_appointment` → `POST /voice/appointments/confirm`
  - `cancel_appointment` → `POST /voice/appointments/cancel`
  - `reschedule_appointment` → `POST /voice/appointments/reschedule`
  - `create_appointment_checkout` → `POST /voice/appointments/checkout`
  - `verify_checkout_code` → `POST /voice/checkout/verify`
  - `get_patient_claims` → `GET /api/patient/benefits` or similar
- **Fix Needed**: Expose functions via Retell's function calling API

#### **Issue 3: Retell Agent Configuration Mismatch**
- **Problem**: `configure-retell.js` has generic "voice shopping" prompt, not healthcare-specific
- **Current Prompt**: "Help customers find products they're looking for..."
- **Expected Prompt**: Should use `tiba-voice-agent-prompt.md` content
- **Fix Needed**: Update Retell agent configuration with healthcare-specific prompt

### 🔧 **Recommended Fixes**

1. **Implement Retell LLM WebSocket Handler**:
   ```javascript
   // webhooks/retell-llm-websocket.js
   // Handle WebSocket connections from Retell
   // Parse function calls and route to appropriate endpoints
   // Return function results to Retell
   ```

2. **Expose Functions to Retell**:
   ```javascript
   // In Retell agent configuration, add:
   general_tools: [
     {
       type: 'function',
       name: 'collect_insurance',
       description: 'Collect and verify insurance information',
       parameters: { ... }
     },
     {
       type: 'function',
       name: 'schedule_appointment',
       description: 'Schedule a new appointment',
       parameters: { ... }
     },
     // ... etc
   ]
   ```

3. **Update Retell Agent Prompt**:
   - Use content from `tiba-voice-agent-prompt.md`
   - Configure as "Selma" healthcare assistant
   - Set proper system persona and rules

---

## 2. FHIR Integration Assessment

### ✅ **What's Working**

1. **FHIR Service Layer** (`services/fhir-service.js`):
   - `getOrCreatePatient()` ✅
   - `createEncounter()` ✅
   - `createCommunication()` ✅
   - `createObservation()` ✅
   - `getPatientEverything()` ✅

2. **FHIR API Endpoints** (`routes/fhir.js`):
   - `GET /fhir/Patient` ✅
   - `POST /fhir/Patient` ✅
   - `GET /fhir/Patient/:id` ✅
   - `GET /fhir/Patient/:id/$everything` ✅
   - `GET /fhir/Encounter` ✅
   - `POST /fhir/Encounter` ✅
   - `GET /fhir/metadata` ✅

3. **FHIR Integration in Booking**:
   - `BookingService.scheduleAppointment()` creates FHIR Patient and Encounter ✅
   - Voice calls create FHIR Encounter via `FHIRAdapter.retellCallToFHIR()` ✅

### ⚠️ **Issues**

1. **FHIR Patient Linking**:
   - Appointments link to FHIR patients via `patient_id` ✅
   - But patient lookup by phone/email could be improved
   - **Recommendation**: Add patient search by phone/email in voice agent flow

2. **FHIR Resource Updates**:
   - Encounters are created but not always updated (e.g., when appointment status changes)
   - **Recommendation**: Update Encounter status when appointment is confirmed/cancelled

---

## 3. Patient Wallet Assessment

### ✅ **What's Working**

1. **Circle USDC Wallet**:
   - `POST /api/circle/wallets` - Create wallet ✅
   - `GET /api/circle/accounts/:entityType/:entityId` - Get balance ✅
   - `POST /api/patient/wallet/deposit` - Deposit money ✅
   - `POST /api/patient/wallet/pay-claim` - Pay claim from wallet ✅
   - `GET /api/patient/wallet/transactions` - Get transaction history ✅

2. **Circle Service** (`services/circle-service.js`):
   - Wallet creation ✅
   - Balance checking ✅
   - USDC transfers ✅
   - Webhook verification ✅

### ❌ **Critical Issues**

#### **Issue 1: Patient Wallet Not Linked to FHIR Patient**
- **Problem**: Wallets are created with `entityId` but not linked to FHIR Patient resource
- **Impact**: Cannot easily find patient wallet from FHIR Patient ID
- **Fix Needed**: Link wallet `entityId` to FHIR Patient `resource_id`

#### **Issue 2: No Stripe Integration for Patient Wallet**
- **Problem**: Patient wallet only supports Circle USDC, not Stripe
- **Impact**: Patients cannot fund wallet with credit card
- **Fix Needed**: Add Stripe payment method to fund patient wallet

#### **Issue 3: Wallet Not Used in Appointment Payment Flow**
- **Problem**: Appointment checkout uses email verification → Stripe link, not wallet
- **Impact**: Patient wallet balance is not used for appointments
- **Fix Needed**: Add wallet payment option to appointment checkout

### 🔧 **Recommended Fixes**

1. **Link Wallet to FHIR Patient**:
   ```javascript
   // When creating wallet, store FHIR patient_id
   wallet = {
     entityType: 'patient',
     entityId: fhirPatientId, // Use FHIR patient resource_id
     description: `Patient wallet for ${patientName}`
   }
   ```

2. **Add Stripe Wallet Funding**:
   ```javascript
   // POST /api/patient/wallet/fund
   // Accept Stripe payment
   // Transfer to Circle wallet
   ```

3. **Add Wallet Payment Option**:
   ```javascript
   // In appointment checkout, check wallet balance
   // If sufficient, offer wallet payment
   // Otherwise, use Stripe
   ```

---

## 4. EPIC API Integration Assessment

### ❌ **Critical Issues**

#### **Issue 1: EPIC Integration Not Fully Implemented**
- **Problem**: EPIC adapter exists (`services/epic-adapter.js`) but endpoints are minimal
- **Current State**: 
  - `GET /api/ehr/epic/connect` exists
  - `GET /api/ehr/epic/callback` exists
  - `POST /api/ehr/epic/sync` exists
- **Missing**: Actual EPIC API calls to fetch patient data, encounters, etc.
- **Fix Needed**: Implement EPIC FHIR API integration

#### **Issue 2: No EPIC Patient Data Sync**
- **Problem**: EPIC patient data is not synced to local FHIR database
- **Impact**: Cannot access EPIC patient records in voice agent
- **Fix Needed**: Sync EPIC patients to local FHIR database

#### **Issue 3: No EPIC Encounter Sync**
- **Problem**: EPIC encounters are not synced to local database
- **Impact**: Cannot view EPIC encounters in dashboard
- **Fix Needed**: Sync EPIC encounters to local database

### 🔧 **Recommended Fixes**

1. **Implement EPIC FHIR API Client**:
   ```javascript
   // services/epic-adapter.js
   // - Authenticate with EPIC OAuth2
   // - Fetch patient data from EPIC FHIR API
   // - Sync to local FHIR database
   ```

2. **Add EPIC Patient Sync**:
   ```javascript
   // POST /api/ehr/epic/sync/patients
   // Fetch patients from EPIC
   // Create/update local FHIR Patient resources
   ```

3. **Add EPIC Encounter Sync**:
   ```javascript
   // POST /api/ehr/epic/sync/encounters
   // Fetch encounters from EPIC
   // Create/update local FHIR Encounter resources
   ```

---

## 5. Stedi API Integration Assessment

### ❌ **Critical Issues**

#### **Issue 1: Stedi API Not Fully Integrated**
- **Problem**: Stedi service exists (`services/insurance-service.js`) but uses mock data
- **Current State**: 
  - `POST /voice/insurance/collect` - Stores insurance info ✅
  - `POST /voice/insurance/check-eligibility` - Uses mock data ❌
  - `POST /voice/insurance/submit-claim` - Uses mock data ❌
- **Missing**: Actual Stedi API calls for eligibility and claims
- **Fix Needed**: Implement Stedi API integration (requires Stedi API access)

#### **Issue 2: No Real Insurance Verification**
- **Problem**: Insurance eligibility checks return mock data
- **Impact**: Cannot verify real insurance coverage
- **Fix Needed**: Integrate with Stedi Eligibility API

#### **Issue 3: No Real Claim Submission**
- **Problem**: Claim submission uses mock data
- **Impact**: Cannot submit real claims to insurance
- **Fix Needed**: Integrate with Stedi Claims API

### 🔧 **Recommended Fixes**

1. **Implement Stedi Eligibility API**:
   ```javascript
   // services/insurance-service.js
   // - Call Stedi Eligibility API
   // - Parse X12 EDI response
   // - Store eligibility results
   ```

2. **Implement Stedi Claims API**:
   ```javascript
   // services/insurance-service.js
   // - Generate X12 EDI 837 claim
   // - Submit to Stedi Claims API
   // - Track claim status
   ```

3. **Add Stedi Payer Cache**:
   ```javascript
   // Already exists: services/payer-cache-service.js
   // - Cache payer information from Stedi
   // - Reduce API calls
   ```

---

## 6. Stripe Integration Assessment

### ✅ **What's Working**

1. **Stripe Payment Processing**:
   - `POST /api/payment/process` - Process payment ✅
   - `GET /payment/:token` - Payment page ✅
   - `POST /webhooks/stripe` - Webhook handler ✅ (canonical; legacy `/webhook/stripe` disabled by default)

2. **Stripe Service** (`services/payment-service.js`):
   - Payment token generation ✅
   - Checkout retrieval ✅
   - Payment processing ✅

### ⚠️ **Issues**

1. **Stripe Not Used in Patient Wallet**:
   - Patient wallet only uses Circle USDC
   - **Recommendation**: Add Stripe funding option

2. **Stripe Not Used in Direct Payment**:
   - Appointment checkout uses email verification → link
   - **Recommendation**: Add direct Stripe payment option (Payment Intent)

---

## 7. Appointment Booking Workflow Assessment

### ✅ **What's Working**

1. **Booking Service** (`services/booking-service.js`):
   - `scheduleAppointment()` ✅
   - `confirmAppointment()` ✅
   - `cancelAppointment()` ✅
   - `rescheduleAppointment()` ✅
   - `getAvailableSlots()` ✅
   - Google Calendar integration ✅
   - FHIR Patient creation ✅

2. **Appointment Endpoints**:
   - All voice endpoints exist ✅
   - All return proper responses ✅

### ⚠️ **Issues**

1. **Insurance Calculation in Appointment**:
   - Appointment checkout calculates patient responsibility ✅
   - But insurance eligibility is not always checked before booking
   - **Recommendation**: Always check insurance eligibility before booking

2. **Appointment Reminders**:
   - Reminder scheduler exists ✅
   - But may not be sending reminders
   - **Recommendation**: Test reminder functionality

---

## 8. Testing Recommendations

### **Test 1: Voice Agent Function Calls**
```bash
# Test that Retell can call functions
# 1. Call voice agent
# 2. Ask to schedule appointment
# 3. Verify function is called
# 4. Verify appointment is created
```

### **Test 2: Patient Wallet Integration**
```bash
# Test patient wallet with FHIR patient
# 1. Create FHIR patient
# 2. Create patient wallet (linked to FHIR patient)
# 3. Deposit money to wallet
# 4. Pay appointment from wallet
# 5. Verify wallet balance updated
```

### **Test 3: EPIC Integration**
```bash
# Test EPIC patient sync
# 1. Connect to EPIC
# 2. Sync patients from EPIC
# 3. Verify patients in local FHIR database
# 4. Verify appointments linked to EPIC patients
```

### **Test 4: Stedi Integration**
```bash
# Test Stedi insurance verification
# 1. Collect insurance information
# 2. Check eligibility via Stedi API
# 3. Verify eligibility results
# 4. Submit claim via Stedi API
# 5. Verify claim status
```

---

## 9. Priority Fixes

### **High Priority** (Blocking Voice Agent)
1. ✅ **Implement Retell LLM WebSocket Handler** - Voice agent cannot call functions without this
2. ✅ **Expose Functions to Retell** - Voice agent needs functions to be exposed
3. ✅ **Update Retell Agent Configuration** - Use healthcare-specific prompt

### **Medium Priority** (Enhancing Functionality)
4. ✅ **Link Patient Wallet to FHIR Patient** - Need to link wallets to patients
5. ✅ **Add Stripe Wallet Funding** - Patients need to fund wallets with credit cards
6. ✅ **Add Wallet Payment Option** - Use wallet balance for appointments

### **Low Priority** (Future Enhancements)
7. ✅ **Implement EPIC API Integration** - Requires EPIC API access
8. ✅ **Implement Stedi API Integration** - Requires Stedi API access (user mentioned needs payment)
9. ✅ **Add Direct Stripe Payment** - Enhance payment options

---

## 10. What I'm Struggling With / Need Help

### **1. Retell LLM WebSocket Handler**
- **Issue**: Need to implement WebSocket handler for Retell function calls
- **Question**: Do you have Retell API documentation for LLM WebSocket protocol?
- **Help Needed**: Retell WebSocket message format and function calling protocol

### **2. Retell Function Exposure**
- **Issue**: Need to expose functions to Retell agent
- **Question**: How are functions exposed in Retell? Via agent configuration or WebSocket?
- **Help Needed**: Retell function calling API documentation

### **3. EPIC API Access**
- **Issue**: EPIC integration requires EPIC API access
- **Question**: Do you have EPIC API credentials? Epic FHIR endpoint?
- **Help Needed**: EPIC API credentials and endpoint information

### **4. Stedi API Access**
- **Issue**: Stedi integration requires Stedi API access (you mentioned needs payment)
- **Question**: When will Stedi API access be available?
- **Help Needed**: Stedi API credentials when available

### **5. Patient Wallet Testing**
- **Issue**: Need to test patient wallet with real Circle API
- **Question**: Do you have Circle API credentials configured?
- **Help Needed**: Circle API test credentials or sandbox access

---

## 11. Next Steps

1. **Implement Retell LLM WebSocket Handler** (High Priority)
2. **Expose Functions to Retell** (High Priority)
3. **Update Retell Agent Configuration** (High Priority)
4. **Test Voice Agent Function Calls** (High Priority)
5. **Link Patient Wallet to FHIR Patient** (Medium Priority)
6. **Add Stripe Wallet Funding** (Medium Priority)
7. **Test Patient Wallet Integration** (Medium Priority)
8. **Implement EPIC API Integration** (Low Priority - when API access available)
9. **Implement Stedi API Integration** (Low Priority - when API access available)

---

## Summary

### **What's Good** ✅
- Appointment booking endpoints exist and work
- FHIR integration is solid
- Patient wallet infrastructure exists
- Payment processing works
- Insurance endpoints exist

### **What's Missing** ❌
- Retell LLM WebSocket handler (CRITICAL - blocks voice agent)
- Retell function exposure (CRITICAL - blocks voice agent)
- Patient wallet linked to FHIR patients
- Stripe wallet funding
- EPIC API integration (needs API access)
- Stedi API integration (needs API access)

### **What Needs Testing** 🧪
- Voice agent function calls
- Patient wallet integration
- EPIC patient sync
- Stedi insurance verification
- Appointment booking with insurance

---

**Status**: Ready for testing after implementing Retell LLM WebSocket handler and function exposure.



---

<a id="intelligence-layer-layer1-perception-implementation-guide"></a>

## Layer 1: Multimodal Perception Layer

*Former path: `docs/architecture/intelligence-layer/LAYER1_PERCEPTION_IMPLEMENTATION_GUIDE.md`*

## Implementation Guide

**Source**: [MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md](./MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md)  
**Status**: Implemented — `middleware-platform/services/perception-layer/`

---

## Overview

Layer 1 transforms raw multimodal clinical data into a structured **perceptual state** with:
- Visual findings (bounding boxes, confidence, evidence_strength)
- Textual findings (NER entities, severity, temporal)
- Cross-modal links (alignment scores, conflict detection)
- Audit trail for downstream coding

---

## Architecture Summary

| Component | Model/Service | Purpose |
|-----------|---------------|---------|
| **Vision Encoder** | GPT-4o (OpenAI or Azure) | Extract findings from X-ray, MRI, dermatology images |
| **Text Encoder** | medical-text-extraction + medical-abbreviations.json | NER, abbreviation expansion, vitals, temporal, laterality |
| **Audio Encoder** | Not implemented | TODO: Deepgram nova-2-medical (optional) |
| **Cross-Attention** | GPT-4o | Fuse visual + text, compute alignment scores |
| **Perceptual State Builder** | Orchestrator | Combine all outputs, confidence scores, human-review flags |

---

## File Structure (implemented)

```
middleware-platform/
├── services/
│   └── perception-layer/
│       ├── vision-encoder.js          # GPT-4o image analysis (xray, mri, dermatology)
│       ├── text-encoder.js            # NER + medical-abbreviations, temporal, laterality
│       ├── cross-attention.js         # Cross-modal fusion via GPT-4o
│       ├── image-preprocessor.js      # sharp: validate, resize, normalize
│       ├── perceptual-state-builder.js# Main orchestrator, specialty inference, review flags
│       └── index.js                   # Export buildPerceptualState()
└── Knowledge/
    └── ontology/
        ├── medical-abbreviations.json # SOB → shortness of breath, FOOSH, etc.
        ├── extraction-patterns.json   # (existing)
        ├── medical-entities.json      # (existing)
        └── severity-indicators.json   # (existing)
```

**Note**: Audio encoder is a placeholder (not implemented). Image preprocessor lives inside perception-layer.

---

## Environment Variables

```bash
# OpenAI (GPT-4o vision + cross-modal)
OPENAI_API_KEY=sk-...

# Azure OpenAI (alternative, for HIPAA)
# AZURE_OPENAI_API_KEY=
# AZURE_OPENAI_ENDPOINT=
# AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o
# AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Deepgram (optional, for audio)
# DEEPGRAM_API_KEY=

# Hugging Face (optional, for ClinicalBERT)
# HUGGINGFACE_TOKEN=
```

---

## Perceptual State JSON Schema

```json
{
  "call_id": "string",
  "timestamp": "ISO8601",
  "modality": "xray|mri|dermatology",
  "visual_findings": [
    {
      "finding": "cortical_discontinuity",
      "body_region": "distal_radius",
      "laterality": "right",
      "bounding_box": [120, 340, 280, 450],
      "confidence": 0.92,
      "evidence_strength": "definitive|probable|possible|absent",
      "details": {}
    }
  ],
  "textual_findings": [
    {
      "type": "symptom|anatomy|vitals",
      "concept": "wrist_pain",
      "mention": "wrist pain",
      "confidence": 0.95,
      "severity": "moderate",
      "laterality": "right"
    }
  ],
  "cross_modal_links": [
    {
      "text_concept": "wrist_pain",
      "visual_finding": "cortical_discontinuity",
      "alignment_score": 0.95,
      "alignment_type": "strong_match|moderate_match|text_only|conflict",
      "supporting_evidence": "string"
    }
  ],
  "audio_metadata": null,
  "confidence_scores": {
    "vision_confidence": 0.9,
    "text_confidence": 0.85,
    "cross_modal_confidence": 0.9,
    "overall_confidence": 0.88
  },
  "specialty_tag": "orthopedics|cardiology|dermatology|neurology|pulmonology|gastroenterology|emergency|general",
  "expanded_text": "Clinical text with abbreviations expanded (SOB→shortness of breath)",
  "requires_human_review": {
    "flag": false,
    "reasons": [],
    "severity": "CRITICAL|WARNING|null"
  },
  "processing_metadata": { "vision_ms": 1200, "text_ms": 80, "fusion_ms": 800, "total_ms": 2080 }
}
```

---

## Implementation Phases

### Phase 1: Text-Only ✅ Done
- Route PDF and voice through `medical-text-extraction-service` before coding.
- Map output to `textual_findings` schema (symptoms, vitals, severity, temporal).
- Abbreviation expansion via `medical-abbreviations.json` (SOB, FOOSH, CP, etc.).
- `visual_findings` = [], `cross_modal_links` = [] when no image.

### Phase 2: Vision Encoder ✅ Done
- `vision-encoder.js` uses GPT-4o with `HumanMessage` + `image_url`.
- Modality-specific prompts (xray, mri, dermatology).
- Preprocess with `sharp` in `image-preprocessor.js`: validate (≥10KB, ≥256×256), normalize, resize 1024×1024.
- Graceful degradation: if vision fails (API/parse error), continues with text-only.

### Phase 3: Cross-Attention Fusion ✅ Done
- When both visual and textual findings exist, GPT-4o fuses modalities.
- Produces `cross_modal_links` with alignment_score, alignment_type, supporting_evidence.
- Conflict detection (laterality mismatch, low alignment) → `requires_human_review` with severity (CRITICAL/WARNING).

### Phase 4: Audio (not implemented)
- TODO: Deepgram `nova-2-medical` for audio STT.
- Speaker diarization → identify patient vs physician.

---

## Integration

Layer 1 is used by `coding-orchestrator` and `pdf-coding-service`. For LangGraph, it would be the `perceive` node:

```javascript
const { buildPerceptualState } = require('./services/perception-layer');

graph.addNode('perceive', async (state) => {
  const perceptualState = await buildPerceptualState({
    callId: state.call_id,
    imagePath: state.images?.[0],
    clinicalText: state.clinical_text,
    audioPath: state.audio_path,
    modality: state.modality || 'xray'
  });
  return { perceptual_state: perceptualState, current_stage: 'PERCEPTION_COMPLETE' };
});
```

---

## Suggested Enhancements (from architecture review)

1. **Temporal Attention**: For video/gait analysis, add temporal dimension to cross-attention.
2. **Negative Constraint**: Add "negative_constraint" field (e.g., "No vascular compromise").
3. **Multi-slice MRI**: Aggregate findings across slices into single visual_findings object.

---

## Perceptual Gap Fix (Implemented)

Perception now feeds the coder:
- `runCodingPipeline` passes `perceptualState` to `generateCodingSuggestion`
- Evidence-augmented prompt: visual findings prioritized as grounding truth
- `cross_modal_links` mapped into `rationale` + `evidenceTrace` for audit
- `specialty_tag` derived from findings for future RAG routing

---

## Current vs Target

| Input | Current (Layer 1 implemented) |
|-------|-------------------------------|
| Voice / PDF | Clinical text → text encoder (with abbreviation expansion) → perceptual state |
| Image | Vision encoder (GPT-4o) → perceptual state; graceful fallback if API/parse fails |
| Image + Text | Vision + Text → Cross-attention → perceptual state with alignment scores |

---

## Dependencies

- `sharp` — image preprocessing (already installed)
- `@langchain/openai`, `@langchain/core` — GPT-4o vision and cross-attention (already present)

---

## Testing

Run `buildPerceptualState` with `clinicalText` and optionally `imagePath`. No test harness in repo (tests removed). Manual verification:

- Text-only: `buildPerceptualState({ callId, clinicalText, modality: 'text' })`
- Multimodal: `buildPerceptualState({ callId, clinicalText, imagePath, modality: 'xray' })`
- Validation: cross_modal_links alignment_score > 0.7 for strong matches; `requires_human_review` flags laterality conflicts


---

<a id="intelligence-layer-multimodal-medical-ai-architecture"></a>

## Multimodal Medical AI Agent Architecture

*Former path: `docs/architecture/intelligence-layer/MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md`*

## Complete System Design for Clinical Coding & Decision Support

**Version**: 1.0  
**Date**: February 9, 2026  
**Use Cases**: X-rays, MRI, Dermatology Images + Clinical Text/Audio → ICD-10/CPT Coding

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [Layer 1: Multimodal Perception Layer](#layer-1-multimodal-perception-layer)
4. [Layer 2: Agentic RAG & Knowledge Layer](#layer-2-agentic-rag--knowledge-layer)
5. [Layer 3: Reasoning & Coding Agents](#layer-3-reasoning--coding-agents)
6. [Layer 4: Reflection & Critique](#layer-4-reflection--critique)
7. [Infrastructure & Data Flow](#infrastructure--data-flow)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Compliance & Safety](#compliance--safety)
10. [Cost Analysis](#cost-analysis)

---

## Executive Summary

### Problem Statement

Current medical coding systems operate in silos:
- **Image analysis** → Radiologist interpretation → Text notes → Coding
- **Clinical text** → NLP extraction → Code suggestion
- **No true fusion** → Hallucinations, missed diagnoses, billing errors

### Solution Architecture

**Multimodal-at-the-Cognition-Level System** where visual and textual information are fused before reasoning occurs, enabling:

✅ **Cross-modal validation**: "Is the fracture mentioned in notes visible in the X-ray?"  
✅ **Grounded reasoning**: No hallucinated anatomical findings  
✅ **Audit trail**: Every coding decision traceable to source evidence  
✅ **FDA/CMS defensible**: Clear separation of perception, reasoning, and decision-making

### Key Innovation

**From**: `Image → Caption → LLM reads caption → Suggests codes`  
**To**: `Image tokens + Text tokens → Shared latent space → Agentic reasoning → Validated codes`

This is not "AI-assisted coding" — this is **medical intelligence infrastructure**.

---

## System Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          INPUT LAYER                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  X-Ray   │  │   MRI    │  │  Dermat. │  │  Audio   │               │
│  │  Images  │  │  Images  │  │  Images  │  │  (STT)   │               │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘               │
│        │             │              │             │                     │
│        └─────────────┴──────────────┴─────────────┘                     │
│                              │                                           │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              LAYER 1: MULTIMODAL PERCEPTION LAYER                        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  Early Fusion via Cross-Attention                              │    │
│  │                                                                 │    │
│  │  ┌─────────────┐         ┌─────────────┐                      │    │
│  │  │ Vision      │◄────────┤  Clinical   │                      │    │
│  │  │ Encoder     │  Cross- │  Text       │                      │    │
│  │  │ (ViT/Qwen)  │  Attn   │  Encoder    │                      │    │
│  │  └──────┬──────┘         └──────┬──────┘                      │    │
│  │         │                       │                              │    │
│  │         └───────────┬───────────┘                              │    │
│  │                     ▼                                          │    │
│  │          Shared Perceptual Embedding                          │    │
│  │          {visual_findings, textual_findings,                  │    │
│  │           cross_modal_links}                                  │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Models: GPT-4o / Qwen2-VL / LLaVA-Med / Med-Gemini                    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│         LAYER 2: AGENTIC RAG & KNOWLEDGE LAYER                          │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Routing Agent (Specialty Classification)                    │      │
│  │  • Cardiology  • Orthopedics  • Neurology  • Dermatology    │      │
│  │  • Emergency Triage  • General Medicine                      │      │
│  └────────────────────┬─────────────────────────────────────────┘      │
│                       │                                                 │
│                       ▼                                                 │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Hybrid Knowledge Retrieval                                  │      │
│  │                                                               │      │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │      │
│  │  │ Vector DB    │  │ Graph DB     │  │ Live EHR     │      │      │
│  │  │ (Semantic)   │  │ (Relations)  │  │ (API)        │      │      │
│  │  │              │  │              │  │              │      │      │
│  │  │ • Code       │  │ • ICD-CPT    │  │ • Patient    │      │      │
│  │  │   Embeddings │  │   Rules      │  │   History    │      │      │
│  │  │ • Guidelines │  │ • Anatomy    │  │ • Prior      │      │      │
│  │  │ • Similar    │  │   Ontology   │  │   Codes      │      │      │
│  │  │   Cases      │  │ • CMS 2026   │  │              │      │      │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  Storage: pgvector (Postgres) → Pinecone (when scaling)                │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          LAYER 3: REASONING & CODING AGENTS                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  Specialty Sub-Graphs (Conciliator Pattern)                    │    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │    │
│  │  │ Cardiology   │  │ Orthopedics  │  │ Dermatology  │  ...   │    │
│  │  │ Agent        │  │ Agent        │  │ Agent        │        │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │    │
│  │                                                                 │    │
│  │  Each agent:                                                   │    │
│  │  • Domain-specific prompts                                     │    │
│  │  • Specialty coding rules                                      │    │
│  │  • Access to relevant knowledge subgraphs                      │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Output: {proposed_icd10: [...], proposed_cpt: [...],                  │
│           reasoning_trace: [...], confidence_score: 0.XX}               │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          LAYER 4: REFLECTION & CRITIQUE                                 │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  Critique Node (Quality Gate)                                  │    │
│  │                                                                 │    │
│  │  Validates:                                                     │    │
│  │  ✓ Cross-modal consistency (image ↔ text alignment)           │    │
│  │  ✓ CMS 2026 compliance                                         │    │
│  │  ✓ Laterality correctness (left vs right)                     │    │
│  │  ✓ Acuity documentation (acute, chronic, sequela)             │    │
│  │  ✓ Code pair validity (ICD-10 ↔ CPT)                          │    │
│  │  ✓ Hallucination detection                                     │    │
│  │                                                                 │    │
│  │  Decision:                                                      │    │
│  │  • Auto-approve (confidence > 0.85)                            │    │
│  │  • Flag for review (0.60 - 0.85)                               │    │
│  │  • Reject & escalate (< 0.60)                                  │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    OUTPUT LAYER                                          │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ Approved     │  │ Flagged for  │  │ Audit Trail  │                 │
│  │ Codes        │  │ Human Review │  │ (FHIR)       │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Multimodal Perception Layer

### Purpose
**Transform raw multimodal inputs into a unified perceptual representation** where visual and textual evidence are co-present and cross-validated.

### Architecture

#### 1.1 Vision Encoder

**Model Selection Matrix**:

| Use Case | Recommended Model | Why |
|----------|-------------------|-----|
| **X-rays** | Qwen2-VL-7B or GPT-4o | Trained on medical imaging |
| **MRI** | Med-Gemini (when available) or Qwen2-VL | Multi-slice understanding |
| **Dermatology** | GPT-4o or LLaVA-Med | Lesion detection, skin texture |
| **General** | GPT-4o (multimodal) | Best cross-modal fusion |

**Recommended Stack**:
```
Primary: GPT-4o (via Azure OpenAI for HIPAA compliance)
Fallback/Fine-tuning: Qwen2-VL-7B (open-source, deployable on-prem)
```

#### 1.2 Text/Audio Encoder

**Text Processing**:
```
Clinical Text → ClinicalBERT → Text Embeddings (768d)
                ↓
         Expansion via Medical Dictionary
                ↓
         "SOB" → "shortness of breath"
         "FOOSH" → "fall on outstretched hand"
```

**Audio Processing**:
```
Audio (from call) → Deepgram STT (HIPAA-compliant)
                  → Text normalization
                  → ClinicalBERT
```

**Why ClinicalBERT stays**:
- Domain-specific understanding of medical language
- Feeds tokens into multimodal fusion model
- Does NOT make final decisions (avoids single-modality hallucination)

#### 1.3 Cross-Attention Mechanism

**Implementation** (conceptual):

```python
class MultimodalFusionLayer:
    def __init__(self):
        self.vision_encoder = Qwen2VL()  # or GPT4o
        self.text_encoder = ClinicalBERT()
        self.cross_attention = CrossAttentionBlock(
            dim=768,
            num_heads=12
        )
    
    def forward(self, image, text):
        # 1. Extract modality-specific features
        visual_tokens = self.vision_encoder(image)    # [batch, num_patches, 768]
        text_tokens = self.text_encoder(text)          # [batch, seq_len, 768]
        
        # 2. Cross-attention: text queries visual evidence
        fused = self.cross_attention(
            queries=text_tokens,      # "Is there a fracture?"
            keys=visual_tokens,       # Image patches
            values=visual_tokens      # "Yes, in these regions"
        )
        
        # 3. Bi-directional fusion (optional)
        fused_reversed = self.cross_attention(
            queries=visual_tokens,
            keys=text_tokens,
            values=text_tokens
        )
        
        return {
            'text_to_image': fused,
            'image_to_text': fused_reversed
        }
```

**Key Insight**: 
> Text asks: "Patient reports wrist pain after fall. Is there visual evidence?"  
> Visual tokens answer: "Yes, cortical discontinuity detected in distal radius, right side, probability 0.92"

This enables **grounded** code suggestions, not hallucinated ones.

#### 1.4 Output Format (Perceptual State)

**JSON Schema**:

```json
{
  "call_id": "call_12345",
  "timestamp": "2026-02-09T14:30:00Z",
  
  "visual_findings": [
    {
      "modality": "xray",
      "body_region": "distal_radius_right",
      "finding": "cortical_discontinuity",
      "confidence": 0.92,
      "bounding_box": [120, 340, 280, 450],
      "laterality": "right",
      "evidence_strength": "definitive"
    }
  ],
  
  "textual_findings": [
    {
      "concept": "FOOSH_injury",
      "mention": "fell on outstretched hand",
      "confidence": 0.87,
      "span": [45, 72]
    },
    {
      "concept": "wrist_pain",
      "severity": "moderate",
      "confidence": 0.95
    }
  ],
  
  "cross_modal_links": [
    {
      "text_concept": "wrist_pain",
      "visual_finding": "distal_radius_fracture",
      "alignment_score": 0.90,
      "supporting_evidence": "Patient-reported pain location matches fracture site"
    }
  ],
  
  "audio_metadata": {
    "speaker_diarization": ["patient", "physician"],
    "key_phrases": ["can't move my wrist", "heard a crack"],
    "sentiment": "distressed"
  }
}
```

**This perceptual state becomes the input to all downstream agents.**

---

## Layer 2: Agentic RAG & Knowledge Layer

### Purpose
**Dynamically retrieve relevant medical knowledge** based on perceptual state, routing to specialty-specific knowledge graphs.

### 2.1 Routing Agent

**Classifier Implementation**:

```javascript
class RoutingAgent {
    async classify(perceptualState) {
        const { visual_findings, textual_findings } = perceptualState;
        
        // Rule-based triage (fast path)
        const redFlags = this.detectRedFlags(textual_findings);
        if (redFlags.isEmergency) {
            return {
                urgency: 'EMERGENT',
                specialty: 'emergency',
                route: 'human_immediate_review',
                reason: redFlags.reason
            };
        }
        
        // LLM-based specialty routing
        const specialty = await this.classifySpecialty(
            visual_findings,
            textual_findings
        );
        
        return {
            urgency: this.calculateUrgency(perceptualState),
            specialty: specialty,
            route: `${specialty}_agent`,
            confidence: specialty.confidence
        };
    }
    
    detectRedFlags(findings) {
        // Chest pain + radiation → cardiology STAT
        // Stroke symptoms → neurology STAT
        // Compound fracture → orthopedics STAT + surgery consult
        // ...
    }
    
    async classifySpecialty(visualFindings, textualFindings) {
        const prompt = `
        Given:
        - Visual: ${JSON.stringify(visualFindings)}
        - Text: ${JSON.stringify(textualFindings)}
        
        Classify specialty:
        - cardiology: heart, chest pain, arrhythmia
        - orthopedics: fractures, joints, musculoskeletal
        - dermatology: skin lesions, rashes, moles
        - neurology: headaches, seizures, stroke symptoms
        - general: routine, preventive care
        
        Return JSON: {specialty: string, confidence: number}
        `;
        
        return await this.llm.invoke(prompt);
    }
}
```

**Routing Logic**:

```
IF visual_findings contains "fracture" AND body_region contains "radius|ulna|femur"
  → Route to: orthopedics_agent

IF visual_findings contains "mass|nodule" AND body_region contains "lung|mediastinum"
  → Route to: pulmonology_agent + radiology_review

IF textual_findings contains "chest_pain" AND visual_findings contains "cardiomegaly"
  → Route to: cardiology_agent + priority_high

IF dermatology_image AND visual_findings contains "melanoma_features"
  → Route to: dermatology_agent + dermatopathology_consult
```

### 2.2 Knowledge Retrieval System

**Multi-Source RAG**:

```
┌─────────────────────────────────────────────────────┐
│  Hybrid Retrieval Strategy                          │
│                                                      │
│  Query: "distal radius fracture + FOOSH injury"     │
│                                                      │
│  1. Vector DB (Semantic Search)                     │
│     → Similar cases: S52.501A, S52.521A            │
│     → Guidelines: "Colles fracture coding"          │
│                                                      │
│  2. Graph DB (Rule-based)                           │
│     → ICD-10 → CPT pairs: S52.501A → 25600        │
│     → Laterality rules: "right wrist" → code 7th   │
│                                                      │
│  3. Live EHR (Patient Context)                      │
│     → Prior fractures? Osteoporosis?               │
│     → Current medications (anticoagulants?)         │
│                                                      │
│  4. CMS Guidelines (Compliance)                     │
│     → 2026 coding updates                           │
│     → Documentation requirements                    │
└─────────────────────────────────────────────────────┘
```

#### 2.2.1 Vector Database (Semantic)

**Schema** (pgvector):

```sql
CREATE TABLE code_embeddings (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20),
    code_type VARCHAR(10),  -- 'icd10' | 'cpt' | 'hcpcs'
    description TEXT,
    embedding vector(1536),  -- OpenAI text-embedding-3-small
    source VARCHAR(20),       -- 'primary' | 'synonym' | 'guideline'
    specialty VARCHAR(50),    -- 'orthopedics' | 'cardiology' | ...
    created_at TIMESTAMP
);

CREATE INDEX ON code_embeddings USING hnsw (embedding vector_cosine_ops);

-- Similar cases
CREATE TABLE case_embeddings (
    id SERIAL PRIMARY KEY,
    case_summary TEXT,
    final_codes JSONB,        -- {icd10: [...], cpt: [...]}
    outcome VARCHAR(50),      -- 'approved' | 'revised' | 'rejected'
    embedding vector(1536),
    created_at TIMESTAMP
);
```

**Retrieval Example**:

```javascript
async retrieveRelevantCodes(perceptualState) {
    // 1. Build search query from perceptual state
    const query = this.buildSearchQuery(perceptualState);
    // "distal radius fracture right wrist acute FOOSH mechanism"
    
    // 2. Embed query
    const queryEmbedding = await this.embedText(query);
    
    // 3. Hybrid search: semantic + keyword
    const semanticResults = await this.vectorSearch(queryEmbedding, {
        specialty: perceptualState.specialty || 'all',
        limit: 10
    });
    
    const keywordResults = await this.keywordSearch(query);
    
    // 4. Merge & re-rank
    return this.mergeResults(semanticResults, keywordResults);
}

async vectorSearch(embedding, options) {
    const { specialty, limit } = options;
    
    const query = `
        SELECT 
            code,
            description,
            1 - (embedding <=> $1::vector) AS similarity,
            specialty
        FROM code_embeddings
        WHERE 
            (specialty = $2 OR $2 = 'all')
            AND 1 - (embedding <=> $1::vector) >= 0.7
        ORDER BY similarity DESC
        LIMIT $3
    `;
    
    return await this.db.query(query, [
        JSON.stringify(embedding),
        specialty,
        limit
    ]);
}
```

#### 2.2.2 Knowledge Graph (Neo4j or in-memory)

**Schema**:

```cypher
// ICD-10 Code Node
(:ICD10 {
    code: "S52.501A",
    description: "Unspecified fracture of the lower end of right radius, initial encounter",
    category: "Injury",
    body_system: "Musculoskeletal",
    laterality: "Right"
})

// CPT Code Node
(:CPT {
    code: "25600",
    description: "Closed treatment of distal radial fracture",
    rvu: 12.34,
    global_period: 90
})

// Relationships
(:ICD10 {code: "S52.501A"})-[:PAIRS_WITH {validity: 1.0}]->(:CPT {code: "25600"})
(:ICD10 {code: "S52.501A"})-[:REQUIRES_MODIFIER {modifier: "RT"}]->()
(:ICD10 {code: "S52.501A"})-[:EXCLUDES]->(:ICD10 {code: "S52.502A"})
(:ICD10 {code: "S52.501A"})-[:PARENT]->(:ICD10 {code: "S52.5"})

// Anatomy ontology
(:BodyPart {name: "distal_radius"})-[:PART_OF]->(:BodyPart {name: "wrist"})
(:BodyPart {name: "distal_radius"})-[:ADJACENT_TO]->(:BodyPart {name: "ulna"})
```

**Query Examples**:

```cypher
// Find valid CPT codes for an ICD-10
MATCH (icd:ICD10 {code: $icdCode})-[:PAIRS_WITH]->(cpt:CPT)
WHERE cpt.validity > 0.8
RETURN cpt.code, cpt.description, cpt.rvu
ORDER BY cpt.rvu DESC;

// Check laterality consistency
MATCH (icd:ICD10 {code: $icdCode})
WHERE icd.laterality = 'Right'
  AND $detectedLaterality != 'Right'
RETURN {
    valid: false,
    reason: "Laterality mismatch: code is right-specific but finding is " + $detectedLaterality
};

// Find alternative codes (differential diagnosis)
MATCH (icd:ICD10 {code: $icdCode})-[:SIMILAR_TO]->(alternative:ICD10)
RETURN alternative.code, alternative.description;
```

#### 2.2.3 CMS Guidelines Retrieval

**Ingestion Process**:

```javascript
// scripts/ingest-cms-guidelines.js
async function ingestGuidelines() {
    // 1. Download CMS ICD-10-CM Official Guidelines (PDF)
    const pdf = await fetch('https://cms.gov/files/icd10-guidelines-2026.pdf');
    
    // 2. Extract text & chunk
    const text = await extractTextFromPDF(pdf);
    const chunks = chunkText(text, {
        chunkSize: 500,
        overlap: 100
    });
    
    // 3. Embed chunks
    const embeddings = await embedBatch(chunks);
    
    // 4. Store in pgvector
    await db.query(`
        INSERT INTO guideline_chunks (section, text, embedding, year)
        VALUES ($1, $2, $3, 2026)
    `, [...]);
}
```

**Retrieval**:

```javascript
async retrieveGuidelines(perceptualState) {
    // Build query from proposed codes
    const query = `
        Coding guidelines for ${perceptualState.proposedCodes.icd10[0]} 
        in context of ${perceptualState.visual_findings[0].finding}
    `;
    
    const queryEmbedding = await this.embedText(query);
    
    const results = await this.db.query(`
        SELECT section, text, 
               1 - (embedding <=> $1::vector) AS relevance
        FROM guideline_chunks
        WHERE year = 2026
          AND 1 - (embedding <=> $1::vector) >= 0.75
        ORDER BY relevance DESC
        LIMIT 5
    `, [JSON.stringify(queryEmbedding)]);
    
    return results.rows;
}
```

### 2.3 Memory Layer (Persistent Learning)

**What to remember**:

```javascript
class PersistentMemory {
    // Physician preferences
    async rememberPhysicianPreference(physicianId, preference) {
        await this.mem0.add({
            user_id: physicianId,
            type: 'coding_preference',
            data: preference
            // e.g., "Dr. Smith prefers conservative coding for non-displaced fractures"
        });
    }
    
    // Successful code pairs
    async rememberSuccessfulPair(icdCode, cptCode, context) {
        await this.db.query(`
            INSERT INTO successful_code_pairs 
            (icd10, cpt, context_embedding, approval_count)
            VALUES ($1, $2, $3, 1)
            ON CONFLICT (icd10, cpt) 
            DO UPDATE SET approval_count = successful_code_pairs.approval_count + 1
        `, [icdCode, cptCode, await this.embedText(context)]);
    }
    
    // Rejected codes (learn from mistakes)
    async rememberRejection(proposedCodes, actualCodes, reason) {
        await this.db.query(`
            INSERT INTO code_rejections 
            (proposed_icd10, proposed_cpt, actual_icd10, actual_cpt, reason, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [...]);
    }
}
```

---

## Layer 3: Reasoning & Coding Agents

### Purpose
**Specialty-specific agents reason over perceptual state + retrieved knowledge** to propose codes with detailed justification.

### 3.1 Conciliator Architecture

**Pattern**: Central orchestrator delegates to specialty sub-graphs

```javascript
class CodingOrchestrator {
    constructor() {
        this.agents = {
            orthopedics: new OrthopedicsAgent(),
            cardiology: new CardiologyAgent(),
            dermatology: new DermatologyAgent(),
            general: new GeneralMedicineAgent()
        };
    }
    
    async route(perceptualState, classification) {
        const specialty = classification.specialty;
        const agent = this.agents[specialty] || this.agents.general;
        
        return await agent.processClaim(perceptualState);
    }
}
```

### 3.2 Specialty Agent Template

**Example: Orthopedics Agent**

```javascript
class OrthopedicsAgent {
    constructor() {
        this.llm = new ChatGroq({ model: 'llama-3.1-70b-versatile' });
        this.knowledge = new KnowledgeService();
    }
    
    async processClaim(perceptualState) {
        // 1. Retrieve orthopedics-specific knowledge
        const relevantCodes = await this.knowledge.retrieve({
            specialty: 'orthopedics',
            findings: perceptualState.visual_findings,
            symptoms: perceptualState.textual_findings
        });
        
        // 2. Build reasoning prompt
        const prompt = this.buildReasoningPrompt(
            perceptualState,
            relevantCodes
        );
        
        // 3. LLM reasoning
        const reasoning = await this.llm.invoke(prompt);
        
        // 4. Parse structured output
        return this.parseReasoningOutput(reasoning);
    }
    
    buildReasoningPrompt(state, knowledge) {
        return `
You are an expert medical coding specialist in Orthopedics.

PERCEPTUAL STATE:
${JSON.stringify(state, null, 2)}

RETRIEVED KNOWLEDGE:
${knowledge.codes.map(c => `- ${c.code}: ${c.description}`).join('\n')}

GUIDELINES:
${knowledge.guidelines.map(g => g.text).join('\n---\n')}

TASK:
Propose ICD-10 and CPT codes for this case. For each code, provide:
1. Code + description
2. Justification (reference visual/textual evidence)
3. Confidence score (0-1)
4. Alternative codes considered
5. Laterality verification

CRITICAL RULES:
- Laterality MUST match visual findings
- Acute vs chronic: use encounter context
- Initial encounter (A) vs subsequent (D) vs sequela (S)
- Check for code pair validity

Return JSON:
{
  "icd10_codes": [
    {
      "code": "S52.501A",
      "description": "...",
      "justification": "Visual finding of cortical discontinuity in distal radius (right) at coordinates [120,340,280,450] with confidence 0.92. Patient reported FOOSH mechanism. Laterality verified as 'right' from both image and clinical note.",
      "confidence": 0.88,
      "evidence": {
        "visual": ["distal_radius_fracture"],
        "textual": ["FOOSH_injury", "wrist_pain"],
        "cross_modal_alignment": 0.90
      }
    }
  ],
  "cpt_codes": [
    {
      "code": "25600",
      "description": "Closed treatment of distal radial fracture",
      "justification": "No mention of surgical reduction. Initial encounter, simple fracture pattern.",
      "confidence": 0.85
    }
  ],
  "alternatives_considered": [
    {
      "code": "S52.502A",
      "reason_rejected": "Left side specified, but finding is right-sided"
    }
  ]
}
        `;
    }
}
```

### 3.3 Code Suggestion Algorithm

**Multi-stage process**:

```javascript
class CodeSuggestionEngine {
    async suggestCodes(perceptualState, specialty) {
        // Stage 1: Candidate generation (broad)
        const candidates = await this.generateCandidates(perceptualState);
        
        // Stage 2: Filtering (narrow)
        const filtered = this.filterByRules(candidates, perceptualState);
        
        // Stage 3: Ranking (prioritize)
        const ranked = await this.rankBySimilarity(filtered, perceptualState);
        
        // Stage 4: Validation (safety)
        const validated = this.validatePairs(ranked);
        
        return validated;
    }
    
    async generateCandidates(state) {
        // Semantic search
        const semantic = await this.vectorDB.search(state, { limit: 20 });
        
        // Keyword match
        const keyword = await this.keywordSearch(state);
        
        // Historical (from similar cases)
        const historical = await this.findSimilarCases(state);
        
        // Merge (union)
        return [...new Set([...semantic, ...keyword, ...historical])];
    }
    
    filterByRules(candidates, state) {
        return candidates.filter(code => {
            // Laterality check
            if (code.laterality && code.laterality !== state.laterality) {
                return false;
            }
            
            // Acuity check (acute vs chronic)
            if (state.onset === 'sudden' && code.category === 'chronic') {
                return false;
            }
            
            // Specialty match
            if (code.specialty !== state.specialty && code.specialty !== 'general') {
                return false;
            }
            
            return true;
        });
    }
    
    async rankBySimilarity(candidates, state) {
        // Compute similarity to perceptual state
        const stateEmbedding = await this.embedState(state);
        
        return candidates.map(code => ({
            ...code,
            similarity: this.cosineSimilarity(stateEmbedding, code.embedding)
        })).sort((a, b) => b.similarity - a.similarity);
    }
    
    validatePairs(codes) {
        const icd10Codes = codes.filter(c => c.type === 'icd10');
        const cptCodes = codes.filter(c => c.type === 'cpt');
        
        const validPairs = [];
        
        for (const icd of icd10Codes) {
            for (const cpt of cptCodes) {
                const validation = this.validatePair(icd.code, cpt.code);
                if (validation.valid) {
                    validPairs.push({
                        icd10: icd,
                        cpt: cpt,
                        pairValidity: validation.score
                    });
                }
            }
        }
        
        return validPairs.sort((a, b) => 
            b.pairValidity - a.pairValidity
        ).slice(0, 5);
    }
}
```

---

## Layer 4: Reflection & Critique

### Purpose
**Quality gate that validates reasoning before codes reach billing system** — detects hallucinations, CMS violations, and cross-modal inconsistencies.

### 4.1 Critique Node Architecture

```javascript
class CritiqueNode {
    constructor() {
        this.reviewerLLM = new ChatGroq({ 
            model: 'llama-3.1-70b-versatile',
            temperature: 0.1  // Low temp for consistent validation
        });
    }
    
    async critique(codingResult, perceptualState) {
        const checks = await Promise.all([
            this.checkCrossModalConsistency(codingResult, perceptualState),
            this.checkCMSCompliance(codingResult),
            this.checkLateralityAccuracy(codingResult, perceptualState),
            this.checkHallucinationRisk(codingResult, perceptualState),
            this.checkCodePairValidity(codingResult)
        ]);
        
        const overallValid = checks.every(c => c.passed);
        const criticalFailures = checks.filter(c => c.severity === 'critical' && !c.passed);
        
        return {
            passed: overallValid && criticalFailures.length === 0,
            checks: checks,
            recommendation: this.makeDecision(checks),
            confidence: this.calculateConfidence(checks)
        };
    }
    
    async checkCrossModalConsistency(result, state) {
        // Question: Do visual findings support textual findings?
        const icd10Code = result.icd10_codes[0];
        const visualEvidence = state.visual_findings;
        const textualEvidence = state.textual_findings;
        
        const prompt = `
Review this coding decision for cross-modal consistency:

PROPOSED CODE: ${icd10Code.code} - ${icd10Code.description}

VISUAL EVIDENCE:
${JSON.stringify(visualEvidence, null, 2)}

TEXTUAL EVIDENCE:
${JSON.stringify(textualEvidence, null, 2)}

QUESTIONS:
1. Does the visual finding (${visualEvidence[0]?.finding}) match the coded diagnosis?
2. Is the location consistent? (Visual: ${visualEvidence[0]?.body_region}, Code describes: ?)
3. Is laterality consistent? (Visual: ${visualEvidence[0]?.laterality}, Code: ?)
4. Is severity aligned? (Visual confidence: ${visualEvidence[0]?.confidence}, Text severity: ${textualEvidence[0]?.severity})

Return JSON:
{
  "consistent": true/false,
  "issues": ["issue1", "issue2"],
  "severity": "critical" | "warning" | "info"
}
        `;
        
        const response = await this.reviewerLLM.invoke(prompt);
        const parsed = JSON.parse(response.content.match(/\{[\s\S]*\}/)[0]);
        
        return {
            name: 'cross_modal_consistency',
            passed: parsed.consistent,
            severity: parsed.severity,
            issues: parsed.issues
        };
    }
    
    async checkCMSCompliance(result) {
        // Retrieve relevant CMS guidelines
        const guidelines = await this.retrieveGuidelines(result.icd10_codes[0].code);
        
        const prompt = `
Review this code for 2026 CMS compliance:

CODE: ${result.icd10_codes[0].code}
JUSTIFICATION: ${result.icd10_codes[0].justification}

CMS GUIDELINES:
${guidelines.map(g => g.text).join('\n---\n')}

Check:
1. Is 7th character (encounter type) correct?
2. Are required modifiers present?
3. Is documentation sufficient per CMS rules?
4. Any coding conflicts or excludes?

Return JSON: {compliant: bool, violations: []}
        `;
        
        const response = await this.reviewerLLM.invoke(prompt);
        const parsed = JSON.parse(response.content.match(/\{[\s\S]*\}/)[0]);
        
        return {
            name: 'cms_compliance',
            passed: parsed.compliant,
            severity: parsed.violations.length > 0 ? 'critical' : 'info',
            issues: parsed.violations
        };
    }
    
    checkLateralityAccuracy(result, state) {
        const proposedLaterality = this.extractLaterality(result.icd10_codes[0].code);
        const visualLaterality = state.visual_findings[0]?.laterality;
        
        if (proposedLaterality && visualLaterality) {
            const match = proposedLaterality.toLowerCase() === visualLaterality.toLowerCase();
            return {
                name: 'laterality_check',
                passed: match,
                severity: match ? 'info' : 'critical',
                issues: match ? [] : [`Code specifies ${proposedLaterality} but visual finding shows ${visualLaterality}`]
            };
        }
        
        return { name: 'laterality_check', passed: true, severity: 'info', issues: [] };
    }
    
    async checkHallucinationRisk(result, state) {
        // Hallucination indicators:
        // 1. Code justification mentions anatomical details NOT in visual findings
        // 2. High confidence but low cross-modal alignment
        // 3. Multiple anatomical regions mentioned but only one visualized
        
        const justification = result.icd10_codes[0].justification.toLowerCase();
        const visualFindings = state.visual_findings.map(f => f.finding.toLowerCase());
        
        // Extract anatomy terms from justification
        const anatomyTerms = this.extractAnatomyTerms(justification);
        
        // Check if all mentioned anatomy is visually confirmed
        const hallucinated = anatomyTerms.filter(term => 
            !visualFindings.some(finding => finding.includes(term))
        );
        
        return {
            name: 'hallucination_check',
            passed: hallucinated.length === 0,
            severity: hallucinated.length > 0 ? 'critical' : 'info',
            issues: hallucinated.length > 0 
                ? [`Justification mentions "${hallucinated.join(', ')}" but not found in visual evidence`]
                : []
        };
    }
    
    checkCodePairValidity(result) {
        const icd = result.icd10_codes[0]?.code;
        const cpt = result.cpt_codes[0]?.code;
        
        if (!icd || !cpt) {
            return { name: 'code_pair_validity', passed: false, severity: 'critical', issues: ['Missing ICD or CPT'] };
        }
        
        const validation = this.knowledgeGraph.validatePair(icd, cpt);
        
        return {
            name: 'code_pair_validity',
            passed: validation.valid,
            severity: validation.valid ? 'info' : 'critical',
            issues: validation.valid ? [] : [validation.reason]
        };
    }
    
    makeDecision(checks) {
        const criticalFailures = checks.filter(c => c.severity === 'critical' && !c.passed);
        const warnings = checks.filter(c => c.severity === 'warning' && !c.passed);
        
        if (criticalFailures.length > 0) {
            return {
                action: 'reject',
                reason: `Critical failures: ${criticalFailures.map(c => c.name).join(', ')}`,
                next_step: 'human_review'
            };
        }
        
        if (warnings.length >= 2) {
            return {
                action: 'flag_for_review',
                reason: `Multiple warnings detected`,
                next_step: 'human_review'
            };
        }
        
        return {
            action: 'approve',
            reason: 'All checks passed',
            next_step: 'submit_to_billing'
        };
    }
    
    calculateConfidence(checks) {
        const totalChecks = checks.length;
        const passedChecks = checks.filter(c => c.passed).length;
        
        // Weight critical checks more
        const criticalChecks = checks.filter(c => c.severity === 'critical');
        const passedCritical = criticalChecks.filter(c => c.passed).length;
        
        const baseConfidence = passedChecks / totalChecks;
        const criticalConfidence = criticalChecks.length > 0 
            ? passedCritical / criticalChecks.length 
            : 1.0;
        
        // Weighted average (60% critical, 40% overall)
        return 0.6 * criticalConfidence + 0.4 * baseConfidence;
    }
}
```

### 4.2 Self-Correction Loop

**If critique fails, agent can self-correct**:

```javascript
async processCodingWithReflection(perceptualState) {
    let attempt = 0;
    const maxAttempts = 3;
    
    while (attempt < maxAttempts) {
        // Generate codes
        const result = await this.codingAgent.process(perceptualState);
        
        // Critique
        const critique = await this.critiqueNode.critique(result, perceptualState);
        
        if (critique.passed) {
            return { success: true, result, critique };
        }
        
        // Self-correct: provide critique feedback to agent
        if (attempt < maxAttempts - 1) {
            perceptualState.feedback = {
                issues: critique.checks.filter(c => !c.passed),
                suggestion: "Revise coding based on critique feedback"
            };
        }
        
        attempt++;
    }
    
    // Failed after max attempts → human review
    return {
        success: false,
        result: null,
        critique: critique,
        recommendation: 'escalate_to_human'
    };
}
```

---

## Infrastructure & Data Flow

### 5.1 Complete Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  INPUT                                                                │
│  - X-ray/MRI/Derm images (DICOM → PNG conversion)                    │
│  - Clinical notes (EHR HL7 → text)                                   │
│  - Voice call (MP3 → Deepgram STT → text)                            │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PERCEPTION LAYER (Multimodal Fusion)                                │
│  - GPT-4o or Qwen2-VL: Image → visual_tokens                         │
│  - ClinicalBERT: Text → text_tokens                                  │
│  - CrossAttention(visual_tokens, text_tokens) → perceptual_state     │
│  Output: JSON with visual_findings + textual_findings + links        │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ROUTING (LangGraph Node 1)                                          │
│  - Triage classifier: emergency vs routine                           │
│  - Specialty router: cardiology | orthopedics | dermatology | ...    │
│  Output: { specialty, urgency, route }                               │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE RETRIEVAL (LangGraph Node 2)                              │
│  - Vector DB: Semantic search for similar codes/cases                │
│  - Graph DB: Rule-based ICD-CPT pairs, anatomy ontology              │
│  - Live EHR: Patient history via FHIR API                            │
│  - CMS Guidelines: 2026 coding rules                                 │
│  Output: { relevant_codes, guidelines, similar_cases }               │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SPECIALTY AGENT (LangGraph Node 3)                                  │
│  - Orthopedics | Cardiology | Dermatology | General                  │
│  - LLM reasoning with retrieved knowledge                            │
│  - Propose ICD-10 + CPT with justification                           │
│  Output: { icd10_codes, cpt_codes, reasoning_trace }                 │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  CRITIQUE & VALIDATION (LangGraph Node 4)                            │
│  - Cross-modal consistency check                                     │
│  - CMS compliance validation                                         │
│  - Laterality verification                                           │
│  - Hallucination detection                                           │
│  Decision: approve | flag_for_review | reject                        │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
┌─────────────────┐   ┌─────────────────────┐
│  AUTO-APPROVED  │   │  HUMAN REVIEW QUEUE │
│  → Billing      │   │  - Low confidence   │
│                 │   │  - Validation failed│
│                 │   │  - Emergent cases   │
└─────────────────┘   └─────────────────────┘
```

### 5.2 Technology Stack

| Layer | Component | Technology | Justification |
|-------|-----------|------------|---------------|
| **Perception** | Vision Encoder | GPT-4o (Azure) or Qwen2-VL-7B | HIPAA-compliant, multimodal fusion |
| | Text Encoder | ClinicalBERT | Medical domain specialization |
| | Audio STT | Deepgram | HIPAA, medical vocabulary |
| **Orchestration** | Workflow Engine | LangGraph | State management, DAG execution |
| | State Persistence | PostgresSaver | Audit trail, session recovery |
| **Knowledge** | Vector DB | pgvector (→ Pinecone) | Free, fast, scalable |
| | Embeddings | OpenAI text-embedding-3-small | $0.02 per 1M tokens |
| | Graph DB | Neo4j Community (optional) | Code relationships, ontology |
| | Guidelines | pgvector (text chunks) | CMS 2026 rules |
| **Reasoning** | LLM | Groq (Llama 3.1 70B) | Fast, cheap, good for extraction |
| | Critique LLM | Groq (Llama 3.1 70B) | Consistent validation |
| **Memory** | Session Store | Mem0 or Redis | Physician preferences |
| | Audit Log | PostgreSQL | Compliance, ML training |
| **Hosting** | Compute | AWS EC2 (GPU for Qwen) or Azure | HIPAA BAA available |
| | Storage | S3 (encrypted) | DICOM images, audio files |
| | Database | RDS PostgreSQL 16 + pgvector | Managed, backups |

### 5.3 LangGraph Implementation

**Complete Graph Definition**:

```javascript
const { StateGraph, MemorySaver, PostgresSaver } = require('@langchain/langgraph');

// State schema
const GraphState = {
    call_id: { value: (prev, next) => next || prev },
    clinic_id: { value: (prev, next) => next || prev },
    
    // Inputs
    images: { value: (prev, next) => next || prev, default: () => [] },
    clinical_text: { value: (prev, next) => next || prev, default: () => "" },
    audio_path: { value: (prev, next) => next || prev, default: () => null },
    
    // Perceptual state
    perceptual_state: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Classification
    classification: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Knowledge
    retrieved_knowledge: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Coding
    coding_result: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Validation
    critique_result: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Workflow
    current_stage: { value: (prev, next) => next || prev, default: () => 'INTAKE' },
    route: { value: (prev, next) => next || prev, default: () => 'automated' },
    
    // Metadata
    confidence: { value: (prev, next) => next || prev, default: () => 0 },
    errors: { value: (prev, next) => [...(prev || []), ...(next || [])], default: () => [] }
};

// Build graph
const graph = new StateGraph({ channels: GraphState });

// Node 1: Multimodal perception
graph.addNode('perceive', async (state) => {
    const perceptionService = require('./services/multimodal-perception-service');
    
    const perceptualState = await perceptionService.fuse({
        images: state.images,
        text: state.clinical_text,
        audio: state.audio_path
    });
    
    return {
        perceptual_state: perceptualState,
        current_stage: 'PERCEPTION_COMPLETE'
    };
});

// Node 2: Route to specialty
graph.addNode('route', async (state) => {
    const classifier = require('./services/triage-classifier');
    
    const classification = await classifier.classify(
        state.perceptual_state,
        state.clinical_text
    );
    
    return {
        classification: classification,
        route: classification.route,
        current_stage: 'ROUTING_COMPLETE'
    };
});

// Node 3: Retrieve knowledge
graph.addNode('retrieve_knowledge', async (state) => {
    const ragService = require('./services/agentic-rag-service');
    
    const knowledge = await ragService.retrieve(
        state.perceptual_state,
        state.classification
    );
    
    return {
        retrieved_knowledge: knowledge,
        current_stage: 'KNOWLEDGE_RETRIEVED'
    };
});

// Node 4: Specialty agent coding
graph.addNode('code', async (state) => {
    const orchestrator = require('./services/coding-orchestrator');
    
    const result = await orchestrator.route(
        state.perceptual_state,
        state.classification,
        state.retrieved_knowledge
    );
    
    return {
        coding_result: result,
        current_stage: 'CODING_COMPLETE',
        confidence: result.confidence
    };
});

// Node 5: Critique & validate
graph.addNode('critique', async (state) => {
    const critiqueNode = require('./services/critique-node');
    
    const critique = await critiqueNode.critique(
        state.coding_result,
        state.perceptual_state
    );
    
    return {
        critique_result: critique,
        current_stage: 'VALIDATION_COMPLETE',
        confidence: critique.confidence
    };
});

// Node 6: Human review (terminal)
graph.addNode('human_review', async (state) => {
    const db = require('./database');
    
    await db.flagForHumanReview(state.call_id, {
        reason: state.critique_result.recommendation?.reason || 'Manual review required',
        perceptual_state: state.perceptual_state,
        coding_result: state.coding_result,
        critique: state.critique_result
    });
    
    return { current_stage: 'AWAITING_HUMAN_REVIEW' };
});

// Node 7: Auto-approve (terminal)
graph.addNode('approve', async (state) => {
    const db = require('./database');
    
    await db.submitToBilling(state.call_id, {
        icd10_codes: state.coding_result.icd10_codes,
        cpt_codes: state.coding_result.cpt_codes,
        confidence: state.confidence,
        audit_trail: {
            perceptual_state: state.perceptual_state,
            reasoning: state.coding_result.reasoning_trace,
            validation: state.critique_result
        }
    });
    
    return { current_stage: 'APPROVED_AND_SUBMITTED' };
});

// Edges
graph.setEntryPoint('perceive');
graph.addEdge('perceive', 'route');

// Conditional routing
graph.addConditionalEdges(
    'route',
    (state) => state.route,
    {
        'human_immediate_review': 'human_review',
        'automated': 'retrieve_knowledge',
        'orthopedics_agent': 'retrieve_knowledge',
        'cardiology_agent': 'retrieve_knowledge',
        'dermatology_agent': 'retrieve_knowledge'
    }
);

graph.addEdge('retrieve_knowledge', 'code');
graph.addEdge('code', 'critique');

// After critique: approve or review
graph.addConditionalEdges(
    'critique',
    (state) => state.critique_result.recommendation?.action || 'approve',
    {
        'approve': 'approve',
        'reject': 'human_review',
        'flag_for_review': 'human_review'
    }
);

// Compile with PostgresSaver for persistence
const checkpointer = new PostgresSaver(process.env.POSTGRES_URL);
const compiledGraph = graph.compile({ checkpointer });

module.exports = { compiledGraph };
```

---

## Implementation Roadmap

### Phase 0: Foundation (Week 1-2) - CRITICAL PATH

**Goal**: Basic infrastructure + data pipeline

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 1. Set up cloud infrastructure | 2 days | DevOps | AWS/Azure account, VPC, RDS PostgreSQL |
| 2. Install pgvector extension | 0.5 days | Backend | `CREATE EXTENSION vector` |
| 3. DICOM → PNG conversion pipeline | 2 days | Backend | Script to convert medical images |
| 4. Audio STT integration (Deepgram) | 1 day | Backend | API wrapper, transcript storage |
| 5. Database schema design | 1 day | Backend | Tables for embeddings, cases, audit logs |
| 6. Populate code embeddings | 2 days | ML | 80K ICD-10/CPT codes embedded |
| **Total** | **8.5 days** | | **Testable end-to-end pipeline** |

**Success Criteria**:
- ✅ Image uploaded → converted to PNG
- ✅ Audio uploaded → transcribed to text
- ✅ Code search returns relevant results

---

### Phase 1: Perception Layer (Week 3-4)

**Goal**: Multimodal fusion working

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 7. Integrate GPT-4o (Azure) | 2 days | ML | API key, HIPAA BAA, test calls |
| 8. Alternative: Fine-tune Qwen2-VL | 5 days | ML | Model weights, inference server |
| 9. Build perception service | 3 days | Backend | `multimodal-perception-service.js` |
| 10. Test cross-attention outputs | 2 days | QA | Visual + text alignment verified |
| **Total** | **7-12 days** | | **Perceptual state JSON** |

**Success Criteria**:
- ✅ X-ray + clinical note → perceptual_state with cross-modal links
- ✅ Laterality correctly detected (left vs right)
- ✅ Visual findings confidence > 0.8

---

### Phase 2: Knowledge Layer (Week 5-6)

**Goal**: RAG retrieval working

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 11. Hybrid search implementation | 3 days | Backend | Semantic + keyword merged |
| 12. Ingest CMS guidelines | 2 days | ML | 2026 rules chunked & embedded |
| 13. Build knowledge graph (optional) | 4 days | Backend | Neo4j with ICD-CPT relationships |
| 14. Agentic RAG service | 2 days | Backend | Dynamic retrieval based on state |
| **Total** | **11 days** | | **Knowledge retrieval API** |

**Success Criteria**:
- ✅ Query "distal radius fracture" → top 5 relevant codes
- ✅ Guidelines retrieved for proposed codes
- ✅ Similar cases found from history

---

### Phase 3: Reasoning Agents (Week 7-8)

**Goal**: Code suggestion working

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 15. Build base coding agent | 3 days | ML | LLM-based code proposal |
| 16. Specialty agents (Ortho, Cardio, Derm) | 5 days | ML | 3 specialty prompts + logic |
| 17. Routing classifier | 2 days | ML | Triage + specialty classification |
| 18. Code pair validation | 2 days | Backend | ICD-10 ↔ CPT rules engine |
| **Total** | **12 days** | | **Coding recommendations** |

**Success Criteria**:
- ✅ End-to-end: X-ray + note → suggested codes
- ✅ Accuracy > 80% on test set (50 cases)
- ✅ Valid ICD-CPT pairs only

---

### Phase 4: Critique Layer (Week 9)

**Goal**: Validation & quality gates

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 19. Critique node implementation | 3 days | ML | All validation checks |
| 20. Self-correction loop | 2 days | Backend | Iterative refinement |
| 21. Confidence scoring | 1 day | ML | Multi-factor confidence model |
| 22. Human review UI | 3 days | Frontend | Queue for flagged cases |
| **Total** | **9 days** | | **Full validation pipeline** |

**Success Criteria**:
- ✅ Laterality mismatches caught 100%
- ✅ Hallucinations detected > 90%
- ✅ Auto-approval rate > 60% (confidence > 0.85)

---

### Phase 5: LangGraph Integration (Week 10)

**Goal**: Full orchestration

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 23. Complete graph definition | 2 days | Backend | All nodes + edges |
| 24. PostgresSaver setup | 1 day | Backend | State persistence |
| 25. End-to-end testing | 3 days | QA | 100 test cases |
| 26. Monitoring dashboard | 2 days | Frontend | Mermaid diagram, metrics |
| **Total** | **8 days** | | **Production-ready system** |

**Success Criteria**:
- ✅ Full pipeline: image + text → codes in < 30s
- ✅ State recoverable after crash
- ✅ Audit trail complete for compliance

---

### Phase 6: Production Hardening (Week 11-12)

**Goal**: Compliance, security, monitoring

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 27. HIPAA compliance audit | 3 days | Legal/DevOps | BAAs signed, encryption verified |
| 28. Load testing | 2 days | QA | Handle 1000 concurrent cases |
| 29. Error recovery & retries | 2 days | Backend | Graceful degradation |
| 30. Logging & alerting | 2 days | DevOps | CloudWatch, PagerDuty |
| 31. Documentation | 2 days | All | API docs, runbooks |
| **Total** | **11 days** | | **Launch-ready** |

---

## Compliance & Safety

### 9.1 HIPAA Compliance Checklist

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| **Encryption at rest** | S3 buckets with AES-256, RDS encrypted | ✅ |
| **Encryption in transit** | TLS 1.3 for all API calls | ✅ |
| **Access control** | IAM roles, MFA for admin | ✅ |
| **Audit logging** | All patient data access logged to CloudWatch | ✅ |
| **BAA with vendors** | Azure (GPT-4o), Deepgram, AWS | ✅ |
| **Data retention** | 7 years per HIPAA | ✅ |
| **De-identification** | Option to strip PHI before ML training | ⚠️ Phase 2 |
| **Right to access** | Patient can request their data | ⚠️ Phase 2 |
| **Breach notification** | Automated alerts if anomalous access | ⚠️ Phase 2 |

### 9.2 FDA SaMD Classification

**Current classification**: Likely **Class II (moderate risk)**

**Justification**:
- Assists human coders, does not make final decisions
- Not used for diagnosis (only coding)
- Human-in-the-loop for high-stakes cases

**Path to approval**:
1. Submit 510(k) premarket notification
2. Demonstrate substantial equivalence to existing coding software
3. Provide clinical validation data (accuracy on test set)
4. Outline risk mitigation strategies (human review for low confidence)

**Timeline**: 6-12 months for 510(k) clearance

---

## Cost Analysis

### 10.1 One-Time Setup Costs

| Item | Cost | Notes |
|------|------|-------|
| **Embeddings** | | |
| ICD-10 codes (72K) | $0.70 | OpenAI embedding |
| CPT codes (1.3K) | $0.03 | |
| HCPCS codes (9K) | $0.09 | |
| Synonyms (20K) | $0.20 | |
| CMS guidelines (5K chunks) | $0.05 | |
| **Subtotal** | **$1.07** | |
| | | |
| **Infrastructure** | | |
| AWS setup | $0 | Free tier |
| RDS PostgreSQL (development) | $50/month | db.t3.medium |
| **Subtotal** | **$50** | |
| | | |
| **Model fine-tuning (optional)** | | |
| Qwen2-VL fine-tuning | $500 | GPU hours on Vast.ai |
| **Total One-Time** | **~$551** | |

### 10.2 Per-Document Processing Costs

| Operation | Provider | Cost per Doc | Notes |
|-----------|----------|--------------|-------|
| **Perception** | | | |
| Vision encoding (GPT-4o) | Azure | $0.0015 | ~150 tokens image |
| Text encoding (ClinicalBERT) | Self-hosted | $0 | Free |
| Audio STT (Deepgram) | Deepgram | $0.0043 | ~2 min call |
| **Subtotal** | | **$0.0058** | |
| | | | |
| **Reasoning** | | | |
| Extraction (Groq) | Groq | $0.0001 | ~1000 tokens |
| Classification (Groq) | Groq | $0.00005 | ~500 tokens |
| Code suggestion (Groq) | Groq | $0.00015 | ~1500 tokens |
| Critique (Groq) | Groq | $0.0001 | ~1000 tokens |
| **Subtotal** | | **$0.0004** | |
| | | | |
| **Knowledge** | | | |
| Embedding query | OpenAI | $0.000002 | 1 query |
| Vector DB query | pgvector | $0 | Self-hosted |
| **Subtotal** | | **$0.000002** | |
| | | | |
| **Total per Document** | | **~$0.0062** | **$6.20 per 1000 docs** |

**Comparison**:
- **Manual coding**: $15-40 per document (human coder)
- **This system**: $0.0062 per document
- **Savings**: 99.95%

### 10.3 Monthly Operating Costs (10K docs/month)

| Service | Cost | Notes |
|---------|------|-------|
| Document processing | $62 | 10K × $0.0062 |
| RDS PostgreSQL | $200 | db.r5.large for production |
| EC2 (if self-hosting Qwen) | $300 | g4dn.xlarge (GPU) |
| S3 storage | $50 | 1TB images |
| Data transfer | $30 | |
| Monitoring & logging | $20 | CloudWatch |
| **Total** | **$662/month** | |

**Per-document cost**: $0.066 (all-in)

**Break-even**: If manual coding costs $20/doc, break-even is at **34 documents/month**

---

## Next Steps

### Immediate Actions (This Week)

1. **Infrastructure setup**
   - [ ] Provision AWS/Azure account
   - [ ] Set up RDS PostgreSQL with pgvector
   - [ ] Create S3 bucket for images (encrypted)

2. **Data preparation**
   - [ ] Collect 100 sample cases (X-rays + clinical notes)
   - [ ] Label with ground-truth ICD-10/CPT codes
   - [ ] Convert DICOM images to PNG

3. **Prototype perception layer**
   - [ ] Sign up for Azure OpenAI (GPT-4o)
   - [ ] Test multimodal API with 1 X-ray + note
   - [ ] Validate cross-modal alignment

### Decision Points

**Question 1**: GPT-4o (Azure) vs Qwen2-VL (self-hosted)?

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **GPT-4o** | HIPAA-ready, best fusion, no infra | $0.0015/image, vendor lock-in | **Start here** |
| **Qwen2-VL** | Open-source, cheaper at scale | Requires GPU, fine-tuning needed | Phase 2 |

**Recommendation**: Start with GPT-4o, migrate to Qwen2-VL when processing > 100K docs/month

---

**Question 2**: Neo4j (knowledge graph) or just pgvector?

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Neo4j** | Rich relationships, complex queries | Extra service, cost | Optional |
| **pgvector only** | Simpler, one DB | Harder to model ontologies | **Start here** |

**Recommendation**: Use pgvector for Phase 1, add Neo4j if complex relationship queries become bottleneck

---

**Question 3**: Pinecone or pgvector?

| Option | Pros | Cons | When to use |
|--------|------|------|-------------|
| **pgvector** | Free, same DB, simple | Slower at > 1M vectors | < 100K codes |
| **Pinecone** | Very fast, managed | $70/month | > 1M vectors |

**Recommendation**: pgvector until you hit performance limits (> 1M vectors or > 100ms query latency)

---

## Appendix: File Structure

```
medical-coding-ai/
├── services/
│   ├── multimodal-perception-service.js    # Layer 1: Fusion
│   ├── triage-classifier.js                 # Layer 2: Routing
│   ├── agentic-rag-service.js              # Layer 2: Knowledge
│   ├── coding-orchestrator.js               # Layer 3: Specialty agents
│   ├── orthopedics-agent.js                 # Specialty agent
│   ├── cardiology-agent.js                  # Specialty agent
│   ├── dermatology-agent.js                 # Specialty agent
│   ├── critique-node.js                     # Layer 4: Validation
│   ├── semantic-search-service.js           # Embeddings & search
│   └── knowledge-service.js                 # Code retrieval
│
├── database/
│   ├── schema.sql                           # PostgreSQL schema
│   ├── migrations/                          # DB migrations
│   └── index.js                             # DB connection pool
│
├── scripts/
│   ├── populate-embeddings.js               # One-time setup
│   ├── ingest-guidelines.js                 # CMS guidelines
│   ├── dicom-to-png.js                      # Image conversion
│   └── test-perception.js                   # Testing
│
├── langgraph/
│   ├── coding-graph.js                      # Main graph definition
│   └── graph-visualizer.js                  # Mermaid export
│
├── api/
│   ├── routes/
│   │   ├── submit-case.js                   # POST /api/cases
│   │   ├── get-codes.js                     # GET /api/codes/:callId
│   │   └── human-review.js                  # GET /api/review/queue
│   └── server.js                            # Express app
│
├── config/
│   ├── models.json                          # Model configurations
│   └── specialty-prompts.json               # Agent prompts
│
└── tests/
    ├── perception.test.js
    ├── routing.test.js
    ├── coding.test.js
    └── end-to-end.test.js
```

---

## Summary

You've designed a **true multimodal medical intelligence system** where:

1. **Perception Layer** uses cross-attention to fuse visual + textual evidence *before* reasoning
2. **Agentic RAG** dynamically retrieves specialty-specific knowledge
3. **Reasoning Agents** propose codes grounded in perceptual facts, not hallucinations
4. **Critique Layer** validates cross-modal consistency, CMS compliance, and catches errors
5. **LangGraph** orchestrates the entire flow with state persistence and audit trails

This is **not AI-assisted coding** — it's **medical intelligence infrastructure** ready for FDA/CMS scrutiny.

**Total implementation time**: 10-12 weeks  
**Cost per document**: $0.0062 (vs $15-40 manual)  
**Accuracy target**: > 90% with human review for edge cases

**Next**: Share your current file structure and I'll help you map this architecture to your existing code. 🚀


---

<a id="intelligence-layer-readme"></a>

## Intelligence Layer Architecture

*Former path: `docs/architecture/intelligence-layer/README.md`*

**Last Updated:** April 9, 2026

**Source of Truth**: [MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md](./MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md)  
**Layer 1 Implementation**: [LAYER1_PERCEPTION_IMPLEMENTATION_GUIDE.md](./LAYER1_PERCEPTION_IMPLEMENTATION_GUIDE.md)

---

## Overview

The intelligence layer is the most vital part of the middleware. It implements a **multimodal medical AI architecture** with four layers:

1. **Layer 1: Multimodal Perception** — Transform raw inputs (images, text, audio) into unified perceptual state with cross-modal validation
2. **Layer 2: Agentic RAG & Knowledge** — Retrieve relevant codes, guidelines, similar cases from vector DB and knowledge graph
3. **Layer 3: Reasoning & Coding Agents** — Specialty-specific agents propose ICD-10/CPT codes grounded in perceptual evidence
4. **Layer 4: Reflection & Critique** — Quality gate, hallucination detection, CMS compliance validation

---

## Current vs Target

| Component | Current | Target |
|-----------|---------|--------|
| **Extraction** | Rule-based + abbreviation expansion | LLM-based + ClinicalBERT NER (future) |
| **Vision** | GPT-4o vision encoder (X-ray, MRI, dermatology) | Done |
| **Audio** | Not implemented (Retell ASR elsewhere) | Deepgram nova-2-medical (optional) |
| **Fusion** | Cross-attention (text ↔ image alignment) | Done |
| **Perceptual State** | Full JSON with findings, links, confidence, specialty_tag, review flags | Done |

---

## Build Order

1. **Layer 1 ✅** — Perception implemented; feeds `coding-orchestrator` and `medical-coding-service`
2. Use `OPENAI_API_KEY` or Azure OpenAI from env for GPT-4o (vision + cross-modal reasoning)
3. Integrate with existing `coding-graph.js` as the `perceive` node (when using LangGraph)

---

## Related Docs

- [Middleware Brain Improvements](./README.md#middleware-middleware-brain-improvements-implementation)
- [LangChain/LangGraph Architecture](./README.md#ai-langchain-langgraph-rag-architecture)
- [Knowledge Base](../../knowledge-base/README.md)


---

<a id="maintenance-architecture-issues"></a>

## Architecture Issues Analysis

*Former path: `docs/architecture/maintenance/ARCHITECTURE_ISSUES.md`*

**Date**: January 27, 2025  
**Status**: Critical issues identified that prevent proper multi-tenancy

---

## 🚨 Critical Issues

### 1. **Hardcoded Tenant References**

**Problem**: The system has hardcoded references to `'akin-dunbar'` throughout the codebase.

**Locations**:
- `middleware-platform/routes/voice.js` (lines 56-67)
- `middleware-platform/services/payment-orchestrator.js` (lines 47-59)
- `middleware-platform/server.js` (line 9706)
- `middleware-platform/routes/customer-agent.js` (line 30)

**Impact**:
- ❌ Cannot support multiple tenants properly
- ❌ All requests default to Tenant 1 (akin-dunbar)
- ❌ Tenant 2 will receive Tenant 1's data
- ❌ Breaks data isolation

**Example**:
```javascript
// BAD: Hardcoded fallback
const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');
```

**Fix Required**: Remove all hardcoded references, use dynamic tenant resolution.

---

### 2. **Confusing Entity Model (Customers vs Clinics vs Merchants)**

**Problem**: Three separate entity types with unclear relationships:

- **`customers`** - API/SaaS users (from signup)
- **`clinics`** - Medical clinics (tenants)
- **`merchants`** - E-commerce shops (legacy?)

**Issues**:
- ❌ No clear relationship between them
- ❌ `clinics` has `merchant_id` field (why?)
- ❌ `customers` has `retell_agent_id` (should be on `clinics`)
- ❌ Voice calls use `customer_id` but should use `clinic_id`
- ❌ Payment requests use `merchant_id` but clinics should use `clinic_id`

**Current State**:
```
customers (API users)
  └─ retell_agent_id ❌ (wrong - should be on clinics)

clinics (medical tenants)
  └─ merchant_id ❌ (confusing - why link to merchant?)

merchants (e-commerce shops)
  └─ subdomain (used for routing)
```

**Fix Required**: 
- Clarify entity relationships
- Decide: Is this a medical SaaS (clinics) or e-commerce (merchants)?
- Unify tenant identification

---

### 3. **No Automatic Tenant Provisioning**

**Problem**: Signup creates `customer` but NOT `clinic` (tenant).

**Current Flow**:
```
User signs up → Creates `customer` record
  ❌ No clinic created
  ❌ No Retell agent provisioned
  ❌ No phone number assigned
  ❌ No tenant isolation
```

**Impact**:
- ❌ New signups can't use the system
- ❌ Manual intervention required for each tenant
- ❌ Not scalable

**Fix Required**: 
- Auto-create clinic on signup (for SaaS customers)
- Auto-provision Retell agent
- Auto-assign phone number

---

### 4. **Inconsistent Tenant Identification**

**Problem**: Multiple ways to identify tenants, no single source of truth.

**Methods Used**:
1. **Subdomain** (`akin-dunbar.doclittle.site`) → `merchant.subdomain`
2. **Merchant ID** → `merchant_id` in requests
3. **Clinic ID** → `clinic_id` in database
4. **Phone Number** → `clinic_phone_numbers` lookup
5. **Customer ID** → `customer_id` in voice calls (WRONG)

**Issues**:
- ❌ Voice calls use `customer_id` but should use `clinic_id`
- ❌ Payment requests use `merchant_id` but clinics use `clinic_id`
- ❌ No consistent mapping between these IDs

**Example**:
```javascript
// Voice call uses customer_id (WRONG)
connection.customer_id = message.call.dynamic_variables.clinic_id;

// But should use clinic_id consistently
connection.clinic_id = message.call.dynamic_variables.clinic_id;
```

**Fix Required**: 
- Standardize on `clinic_id` as primary tenant identifier
- Create mapping table if needed
- Update all references

---

### 5. **Dangerous Fallback Logic**

**Problem**: When tenant can't be identified, system falls back to hardcoded tenant or first merchant.

**Locations**:
- `middleware-platform/routes/voice.js` (lines 52-72)
- `middleware-platform/services/payment-orchestrator.js` (lines 42-65)

**Code**:
```javascript
// BAD: Falls back to hardcoded tenant
if (!merchant) {
    const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');
    // OR
    const preferredMerchant = allMerchants.find(m => m.subdomain === 'akin-dunbar') || allMerchants[0];
}
```

**Impact**:
- ❌ Tenant 2's requests could route to Tenant 1
- ❌ Data leakage between tenants
- ❌ Security risk (HIPAA violation if medical data)

**Fix Required**: 
- Remove fallback logic
- Return error if tenant can't be identified
- Require explicit tenant identification

---

### 6. **Mixed Data Models**

**Problem**: Some tables use `clinic_id`, others use `merchant_id`, others use `customer_id`.

**Tables with `clinic_id`**:
- ✅ `clinics`
- ✅ `appointments`
- ✅ `clinic_phone_numbers`
- ✅ `voice_checkouts` (has both `clinic_id` AND `merchant_id`)

**Tables with `merchant_id`**:
- ✅ `merchants`
- ✅ `products`
- ✅ `transactions`
- ✅ `voice_checkouts` (has both!)

**Tables with `customer_id`**:
- ✅ `customers`
- ✅ `voice_call_log` (WRONG - should be `clinic_id`)
- ✅ `api_usage_log`
- ✅ `function_call_log`

**Issues**:
- ❌ `voice_checkouts` has BOTH `clinic_id` AND `merchant_id` (which one?)
- ❌ `voice_call_log` uses `customer_id` but should use `clinic_id`
- ❌ No clear pattern

**Fix Required**: 
- Decide: Use `clinic_id` for all tenant-scoped data
- Migrate `voice_call_log.customer_id` → `clinic_id`
- Remove `merchant_id` from `voice_checkouts` (or clarify relationship)

---

### 7. **No Tenant Context Middleware**

**Problem**: No middleware to extract and validate tenant context from requests.

**Current State**:
- Each route manually extracts tenant
- Inconsistent methods (subdomain, merchant_id, clinic_id)
- No validation
- No error handling

**What's Missing**:
```javascript
// Should have:
app.use(tenantContextMiddleware);

// That extracts:
req.tenant = {
  clinic_id: 'clinic-xxx',
  clinic: { ... },
  validated: true
};
```

**Fix Required**: 
- Create `tenantContextMiddleware`
- Extract tenant from subdomain, phone number, or explicit ID
- Validate tenant exists and is active
- Add to `req.tenant` for all routes

---

### 8. **Voice Call Routing Issues**

**Problem**: Voice calls identify tenant inconsistently.

**Current Flow**:
1. Call comes in → Twilio webhook
2. Look up by phone number → `clinic_phone_numbers`
3. Extract `clinic_id` → Store in `connection.customer_id` (WRONG NAME)
4. Use `customer_id` for billing (WRONG - should be `clinic_id`)

**Issues**:
- ❌ Uses `customer_id` field name but stores `clinic_id` value
- ❌ Confusing naming
- ❌ Billing uses wrong field

**Code**:
```javascript
// BAD: Stores clinic_id in customer_id field
connection.customer_id = clinicPhone.clinic_id;

// Later: Uses customer_id for billing (confusing)
const credits = db.getCustomerCredits(connection.customer_id);
```

**Fix Required**: 
- Rename `connection.customer_id` → `connection.clinic_id`
- Update all references
- Fix billing to use `clinic_id`

---

### 9. **Subdomain Routing Only Works for Merchants**

**Problem**: Subdomain routing looks up `merchants` table, not `clinics`.

**Code** (`server.js` line 391):
```javascript
const merchant = db.getMerchantBySubdomain(subdomain);
```

**Issues**:
- ❌ Clinics have `slug` field but routing uses `merchant.subdomain`
- ❌ No way to route `clinic.doclittle.site` to a clinic
- ❌ Only works for merchants

**Fix Required**: 
- Add `getClinicBySlug()` lookup
- Route subdomains to clinics OR merchants
- Support both entity types

---

### 10. **No Tenant Isolation Enforcement**

**Problem**: No middleware or service layer enforces tenant isolation.

**What's Missing**:
- ❌ No automatic `WHERE clinic_id = ?` filtering
- ❌ No validation that user belongs to tenant
- ❌ No row-level security
- ❌ Queries can return data from wrong tenant

**Example**:
```javascript
// BAD: No tenant filtering
const appointments = db.getAppointments(); // Returns ALL appointments

// GOOD: Should be
const appointments = db.getAppointmentsByClinic(clinic_id);
```

**Fix Required**: 
- Add tenant filtering to all queries
- Create service layer that enforces isolation
- Add validation middleware

---

## 📊 Summary: What's Broken

| Issue | Severity | Impact |
|-------|----------|--------|
| Hardcoded tenant references | 🔴 Critical | Breaks multi-tenancy |
| Confusing entity model | 🔴 Critical | Unclear architecture |
| No auto-provisioning | 🟠 High | Not scalable |
| Inconsistent tenant ID | 🔴 Critical | Data leakage risk |
| Dangerous fallbacks | 🔴 Critical | Security risk |
| Mixed data models | 🟠 High | Confusing codebase |
| No tenant middleware | 🟠 High | Inconsistent behavior |
| Voice routing issues | 🟠 High | Billing errors |
| Subdomain routing | 🟡 Medium | Limited functionality |
| No isolation enforcement | 🔴 Critical | Data leakage |

---

## 🎯 Root Cause

**The system was built for single-tenant (akin-dunbar) and then retrofitted for multi-tenancy without proper refactoring.**

**Evidence**:
1. Hardcoded `'akin-dunbar'` everywhere
2. Fallback to first merchant/tenant
3. Mixed entity models (customers/clinics/merchants)
4. No tenant context middleware
5. Inconsistent ID usage

---

## ✅ What Needs to Happen

### Phase 1: Critical Fixes (Week 1)

1. **Remove all hardcoded tenant references**
   - Replace with dynamic tenant resolution
   - Remove fallback logic

2. **Standardize on `clinic_id`**
   - Use `clinic_id` as primary tenant identifier
   - Update all tables and queries
   - Rename `customer_id` → `clinic_id` in voice calls

3. **Create tenant context middleware**
   - Extract tenant from request
   - Validate tenant exists
   - Add to `req.tenant`

4. **Fix voice call routing**
   - Use `clinic_id` consistently
   - Fix billing to use `clinic_id`

### Phase 2: Architecture Cleanup (Week 2)

5. **Clarify entity relationships**
   - Document: customers vs clinics vs merchants
   - Decide on single entity model
   - Update database schema

6. **Add tenant isolation**
   - Service layer with automatic filtering
   - Validation middleware
   - Row-level security

7. **Fix subdomain routing**
   - Support both clinics and merchants
   - Use `slug` for clinics

### Phase 3: Auto-Provisioning (Week 3)

8. **Auto-create clinic on signup**
   - For SaaS customers, create clinic
   - Provision Retell agent
   - Assign phone number

9. **Add tenant management API**
   - CRUD endpoints for clinics
   - Onboarding service
   - Admin dashboard

---

## 🔧 Quick Wins (Do First)

1. **Create constants file** - Replace `'akin-dunbar'` with constant
2. **Add tenant context middleware** - Extract tenant once, use everywhere
3. **Fix voice call `customer_id`** - Rename to `clinic_id`
4. **Remove fallback logic** - Return error instead of guessing tenant

---

## 📝 Related Documents

- **Onboarding Checklist**: `docs/onboarding/README.md#clinic-onboarding-checklist`
- **Multi-Tenant Architecture**: `docs/architecture/README.md#multi-tenant-multi-tenant-voice-agent`
- **Database Schema**: `docs/architecture/README.md#database-database-schema-approach`

---

**Last Updated**: January 27, 2025  
**Priority**: 🔴 Critical - Fix before onboarding Tenant 2



---

<a id="media-media-layer-architecture"></a>

## DocLittle Media Layer – Architecture Document

*Former path: `docs/architecture/media/MEDIA_LAYER_ARCHITECTURE.md`*

> **Purpose:** Documents the media infrastructure (voice, video, transcription) that connects patients, providers, and the AI agent. Single agent + LLM orchestrate multiple media channels.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Media Channels](#2-media-channels)
3. [Transcription](#3-transcription)
4. [Current Implementation](#4-current-implementation)
5. [Future: LiveKit Video & In-App](#5-future-livekit-video--in-app)
6. [Component Reference](#6-component-reference)
7. [Data Flow & Storage](#7-data-flow--storage)

---

## 1. Executive Overview

### 1.1 Purpose

The Media Layer provides real-time communication channels for:
- **Patient ↔ AI Agent** (voice calls, future: in-app voice/video)
- **Doctor ↔ Patient** (telemedicine video, future)
- **Transcription** (STT) for clinical notes, reports, and downstream coding/billing

One middleware agent + LLM manages all channels. Each provider (Retell, Twilio, LiveKit) is a transport; the agent is channel-agnostic.

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           MEDIA LAYER ARCHITECTURE                                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   MIDDLEWARE AGENT (One brain)                                                            │
│   - LLM (Groq / configured model)                                                         │
│   - coding-state-service, knowledge-service                                               │
│   - Voice adapter, FHIR adapter                                                           │
│                                                                                          │
│         │                              │                              │                   │
│         ▼                              ▼                              ▼                   │
│   ┌──────────┐                  ┌──────────┐                  ┌──────────┐               │
│   │  Retell  │                  │  Twilio  │                  │ LiveKit  │               │
│   │  Voice   │                  │ Calls/SMS│                  │ (Video)  │               │
│   │          │                  │          │                  │ Future   │               │
│   │ • Calls  │                  │ • SIP    │                  │ • Doctor-│               │
│   │ • STT ✓  │                  │ • SMS    │                  │   patient│               │
│   │ • SIP via│                  │ • Phone  │                  │ • In-app │               │
│   │   LiveKit│                  │   prov.  │                  │   video  │               │
│   └────┬─────┘                  └──────────┘                  └──────────┘               │
│        │                                                                                  │
│        │  SIP: sip:{call_id}@5t4n6j0wnrl.sip.livekit.cloud (Retell uses LiveKit for PSTN)│
│        │                                                                                  │
└────────┴──────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Capabilities

| Capability | Channel | Status | Description |
|------------|---------|--------|-------------|
| Voice calls (inbound/outbound) | Retell | ✅ Implemented | AI receptionist, scheduling, triage, insurance |
| Telephony / PSTN | Twilio | ✅ Implemented | SIP trunk, phone provisioning, SMS |
| Transcription (user speech) | Retell | ✅ Implemented | Real-time via WebSocket `message.update.transcript` |
| Conversation memory | Middleware | ✅ Implemented | voice_conversation_memory, coding state |
| FHIR transcript storage | FHIRService | ✅ Implemented | Communication resource for encounters |
| Video (doctor–patient) | LiveKit | 🔜 Future | Telemedicine sessions |
| In-app voice/video | Client SDK | 🔜 Future | Patient-initiated from app |

---

## 2. Media Channels

### 2.1 Retell (Voice)

**Role:** AI voice agent for calls (scheduling, triage, intake, medical coding).

| Item | Details |
|------|---------|
| **WebSocket** | `wss://{host}/webhook/retell/llm` (or configured `RETELL_LLM_WEBSOCKET_URL`) |
| **Handler** | `webhooks/retell-websocket.js` |
| **SIP endpoint** | `sip:{call_id}@5t4n6j0wnrl.sip.livekit.cloud` (Retell’s LiveKit SIP) |
| **Transcription** | `enable_transcription: true` in agent config (`retell-service.js`) |
| **Recording** | `enable_recording: true` |

**Flow:**
1. Twilio receives inbound/outbound call → routes to Retell SIP
2. Retell connects to middleware WebSocket for LLM + tools
3. User speech → Retell STT → `update.transcript` → middleware `handleTranscript`
4. Middleware: `appendConversationMemory`, `processCodingStateTurn`, tool handlers

### 2.2 Twilio (Telephony & SMS)

**Role:** PSTN, phone number provisioning, SMS.

| Item | Details |
|------|---------|
| **Service** | `services/twilio-phone-service.js` (provisioning), `services/sms-service.js` (SMS) |
| **SIP trunk** | `aimedicalvoiceagent.pstn.twilio.com` (Retell termination) |
| **Phone** | +15856202445 (example; configurable) |
| **Docs** | [`docs/middleware-platform/README.md#retell-config-quick-reference`](../middleware-platform/README.md#retell-config-quick-reference) |

**Flow:**
- Patient calls clinic number → Twilio → Retell SIP → Retell → middleware agent
- Outbound: middleware/Retell → Twilio SIP → patient phone
- SMS: reminders, notifications via sms-service

### 2.3 LiveKit (Current vs Future)

**Current:**
- LiveKit is used **only as Retell’s SIP backend** (`sip.livekit.cloud`)
- No direct LiveKit rooms or video in our codebase yet

**Future:**
- **Video rooms** for doctor–patient telemedicine
- **LiveKit Agents** for bots (e.g. translation, summarization)
- **LiveKit Egress** for recording and export
- **Real-time transcription** via LiveKit’s `lk.transcription` (agent sessions)

---

## 3. Transcription

### 3.1 Current Transcription Flow (Retell)

```
User speaks on call
    → Retell STT (internal)
    → WebSocket: message.type = 'update', message.update.transcript = "user said..."
    → retell-websocket.js: handleTranscript(callId, { transcript })
    → appendConversationMemory(callId, clinic_id, 'user', userSaid)
    → processCodingStateTurn(db, callId, 'transcript', {}, { clinic_id })
    → coding-state-service: state machine (INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING)
```

### 3.2 Storage

| Storage | Location | Content |
|---------|----------|---------|
| **voice_conversation_memory** | database.js | Per-turn `role`, `content`, `call_id`, `clinic_id` |
| **voice_call_states** | database.js | `current_stage`, `state_data` |
| **FHIR Communication** | fhir-service.js `storeTranscript()` | Encounter transcript as FHIR Communication |
| **lead_calls** | database.js | `transcript_url` (if provided by Retell) |

### 3.3 Downstream Uses

- **Coding pipeline:** `getConversationHistory()` → context for `getCodeCandidates`, `suggest_codes_from_symptoms`
- **FHIR encounter completion:** Transcript stored as Communication resource
- **Clinical notes / reports:** Raw transcript + LLM structuring (future: SOAP, progress notes)

### 3.4 Future Transcription Options

| Source | Use Case | Notes |
|--------|----------|-------|
| **LiveKit Agents** | Real-time in video rooms | `lk.transcription`, word-by-word sync with agent TTS |
| **LiveKit Egress** | Post-session recording + transcript | Room/track composite → file → 3rd‑party STT or LiveKit transcription |
| **Dedicated STT API** | Custom pipeline | Whisper, AssemblyAI, etc. for raw audio from any channel |
| **Retell (existing)** | Voice calls | Keeps current flow |

---

## 4. Current Implementation

### 4.1 Code Map

| Component | File | Responsibility |
|-----------|------|----------------|
| Retell WebSocket handler | `webhooks/retell-websocket.js` | LLM proxy, transcripts, function calls |
| Transcript handler | `webhooks/retell-websocket.js` → `handleTranscript()` | Store transcript, trigger coding state |
| Retell service | `services/retell-service.js` | Agent creation, `enable_transcription: true` |
| Coding state | `services/coding-state-service.js` | State machine, RAG, code suggestions |
| Conversation memory | `database.js` → `appendConversationMemory`, `getConversationHistory` | Persist turns |
| FHIR transcript | `services/fhir-service.js` → `storeTranscript()` | FHIR Communication resource |
| Voice adapter | `adapters/voice-adapter.js` | Voice ↔ payment request format |
| Twilio | `services/twilio-phone-service.js`, `services/sms-service.js` | Telephony, SMS |

### 4.2 Retell Message Types

| Type | Purpose |
|------|---------|
| `update` | Call state; `update.transcript` = user speech |
| `function_call` | Tool invocation from Retell LLM |
| `response` | Agent response |
| `ping` | Keepalive (respond with `pong`) |

### 4.3 Environment Variables

| Variable | Purpose |
|----------|---------|
| `RETELL_API_KEY` | Retell API |
| `RETELL_LLM_WEBSOCKET_URL` | Middleware WebSocket URL for Retell |
| `RETELL_API_BASE_URL` | Retell API base |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio auth |

---

## 5. Video Consult (LiveKit + AI)

**Status:** Implemented. Multimodal telehealth with transcript, vision, RAG, FHIR.

### 5.1 Architecture

| Component | Location | Purpose |
|-----------|----------|---------|
| Agent events route | `routes/video-consult.js` | `POST /api/video-consult/agent-events` |
| LangGraph | `services/video-consult-graph.js` | accumulate → retrieve_context → human_review → store_fhir |
| Session service | `services/video-consult-service.js` | createSession, endSession, getSessionState |
| Frame storage | `services/frame-storage-service.js` | Temp file handling for vision |
| Review tasks | `services/review-task-service.js` | HITL workflow |

### 5.2 Event Flow

1. Python agents (transcription, vision) send events to middleware
2. `transcript` / `vision_frame` → accumulate state
3. `end_session` → full pipeline (RAG → HITL check → FHIR)
4. Transcript stored as FHIR Communication

See [VIDEO_CONSULT.md](./README.md#care-delivery-video-consult).

---

## 6. Future: LiveKit Video & In-App (Expanded)

### 6.1 Planned Additions

1. **LiveKit video rooms**
   - Doctor–patient telemedicine
   - Same middleware agent logic, different transport
   - Client: LiveKit React/JS SDK in app or web

2. **LiveKit transcription**
   - Option A: LiveKit Agents with `lk.transcription` for real-time captions/notes
   - Option B: LiveKit Egress → recording → STT → structured notes

3. **In-app voice/video**
   - Patient initiates call/video from app (WebRTC or LiveKit client SDK)
   - Routes to same agent and/or provider depending on flow

### 6.2 Architecture (Future)

```
                    ┌─────────────────────┐
                    │  Middleware Agent   │
                    │  (LLM + logic)      │
                    └──────────┬──────────┘
                               │
     ┌─────────────────────────┼─────────────────────────┐
     │                         │                         │
     ▼                         ▼                         ▼
┌──────────┐            ┌──────────┐            ┌──────────┐
│  Retell  │            │  Twilio  │            │ LiveKit  │
│  Voice   │            │ Calls/SMS│            │  Video   │
│  (calls) │            │          │            │  Rooms   │
└──────────┘            └──────────┘            └────┬─────┘
                                                      │
                                               ┌──────┴──────┐
                                               │ In-App SDK  │
                                               │ (patient)   │
                                               └─────────────┘
```

### 6.3 Transcription in LiveKit Context

- **During session:** LiveKit Agents `lk.transcription` → stream to UI and/or middleware
- **After session:** Egress → file → STT (or LiveKit transcription) → notes, coding, claims

---

## 7. Component Reference

### 7.1 Services

| Service | Path | Purpose |
|---------|------|---------|
| retell-service | `services/retell-service.js` | Agent creation, config, transcription/recording flags |
| twilio-phone-service | `services/twilio-phone-service.js` | Phone provisioning |
| sms-service | `services/sms-service.js` | SMS send/receive |
| coding-state-service | `services/coding-state-service.js` | State machine, coding triggers |
| fhir-service | `services/fhir-service.js` | storeTranscript, encounters |
| video-consult-service | `services/video-consult-service.js` | Session, transcript, participants |
| video-consult-graph | `services/video-consult-graph.js` | LangGraph pipeline |
| frame-storage-service | `services/frame-storage-service.js` | Temp frame files |

### 7.2 Database Tables

| Table | Purpose |
|-------|---------|
| voice_call_log | Call metadata, costs, status |
| voice_call_states | Per-call state (INTAKE → BILLING) |
| voice_conversation_memory | Conversation turns (role, content) |
| agent_state_snapshots | State checkpoints |
| coding_decisions | Validation audit (rule_version, rule_hash) |
| lead_calls | transcript_url (if available) |
| video_consult_sessions | Room, encounter, status |
| video_consult_ai_decisions | Audit trail |
| video_consult_review_tasks | HITL tasks |

### 7.3 Webhooks & Routes

| Route | Handler | Purpose |
|-------|---------|---------|
| `/webhook/retell/llm` | retell-websocket.js | Retell LLM WebSocket |
| `/voice/*` | routes/voice.js | Voice API endpoints |
| `/retell-functions` | routes/retell-functions.js | Retell function webhooks |
| `/api/video-consult/agent-events` | routes/video-consult.js | Python agent events |
| `/api/video-consult/session/:roomId` | routes/video-consult.js | Session state for UI |

---

## 8. Data Flow & Storage

### 8.1 Transcript Lifecycle (Current)

```
Call start
    → Retell connects WebSocket
    → User speaks
    → Retell sends update.transcript
    → handleTranscript
        → appendConversationMemory (voice_conversation_memory)
        → processCodingStateTurn (coding-state-service)
    → Coding state may invoke: getCodeCandidates, suggest_codes, validate_code_pair
    → Call end
        → (Optional) FHIR storeTranscript if encounter completed
        → lead_calls.transcript_url if Retell provides URL
```

### 8.2 Integration with Financial Layer

- Transcript + conversation → **coding pipeline** (CodingOrchestrator, MedicalCodingService)
- Structured notes → **claims**, **EOB**, **prior auth** (financial layer)
- Documentation: `docs/architecture/README.md#financial-financial-layer-architecture`

---

## Appendix: LiveKit References

- [LiveKit Egress](https://docs.livekit.io/transport/media/ingress-egress/egress/) – Recording, export
- [LiveKit Agents – Transcriptions](https://docs.livekit.io/agents/v0/voice-agent/transcriptions) – Real-time transcription in agent sessions
- [LiveKit Cloud SIP](https://docs.livekit.io/) – SIP (used by Retell)

---

*Created: January 2026. Media layer architecture for DocLittle.*


---

<a id="middleware-middleware-brain-gap-analysis"></a>

## Middleware Brain Improvements - Gap Analysis & Implementation Status

*Former path: `docs/architecture/middleware/MIDDLEWARE_BRAIN_GAP_ANALYSIS.md`*


**Last Updated:** January 2026  
**Status:** P0/P1 gaps addressed; P2/P3 documented for future work

---

## Executive Summary

This document captures the gap analysis for the Middleware Brain Improvements and implementation status. The main implementation doc is [MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md](./MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md).

---

## Implemented (Jan 2026)

| Gap | Implementation |
|-----|----------------|
| **PII redaction edge cases** | `utils/pii-redactor.js`: Added NHS number, Canadian SIN, MRN patterns; `redactWithLog()` for audit counts |
| **LangSmith project naming** | `utils/langsmith-config.js`: `LANGCHAIN_PROJECT=middleware-{env}` (prod/staging/dev) when not set |
| **HIPAA audit log patient_id** | `hipaa_access_log.patient_id` column; `logHipaaAccess` accepts patient_id; 7-year retention in policy + cleanup script |
| **API key rotation** | `db.rotateMerchantApiKey(merchantId)`; `POST /api/admin/clients/:clinicId/api-keys/rotate` |
| **Idempotency TTL** | 24h TTL, daily cleanup in database.js |

---

## Already Implemented (Prior)

- State sync (LangGraph ↔ DB): migrate, reconcile scripts, dual-write
- Circuit breakers: Stedi, Groq, FHIR, Epic, 1upHealth
- Postgres retry queue: exponential backoff, DLQ, max 5 retries
- Token budget: per-call tracking, graceful degradation
- Feature flags: DB-backed, rollout_pct, clinic allowlist
- Health checks: timeouts, 30s cache, parallel probes
- Runbooks + alert mapping: STEDI_DOWN, GROQ_RATE_LIMIT, etc.
- Load test: `tests/load/basic-load.js`

---

## Remaining Gaps (P2/P3)

| Category | Task | Priority |
|----------|------|----------|
| **Multi-region** | DR plan: active-passive or active-active; RTO/RPO targets | P3 |
| **Distributed tracing** | OpenTelemetry; propagate trace ID from Retell through all calls | P2 |
| **API key rotation** | Automated 90-day rotation; dual-key support during transition | P2 |
| **PII patient names** | Fuzzy name redaction (Mr./Mrs./patient + name) — high false positive risk | P2 |
| **pii_redaction_log table** | Persist redaction counts for audit (currently console only) | P2 |
| **LangSmith** | PHI controls for traces; retention/archival policy doc | P2 |
| **Query optimization** | Slow query log; indexes on hot paths | P3 |
| **Acceptance criteria** | Formal DoD per task in implementation doc | P3 |

---

## Related Documentation

- [Implementation Doc](./MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md)
- [LangChain/LangGraph Architecture](./README.md#ai-langchain-langgraph-rag-architecture)
- [Runbooks](../../runbooks/README.md#readme)
- [Data Retention Policy](../../compliance/README.md#data-retention-policy)


---

<a id="middleware-middleware-brain-improvements-implementation"></a>

## Middleware Brain Improvements: Code Changes & Impact

*Former path: `docs/architecture/middleware/MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md`*

This document maps each improvement from the middleware brain review to specific code changes, what they do, and current status.

**MUST HAVE for tracking:** LangChain + LangSmith and LangGraph are **required**, not optional. Without them, LLM calls and state transitions cannot be traced or audited.

**Gap Analysis Status:** ~70% complete task list, ~30% missing implementation details. This document includes concrete acceptance criteria, code examples, edge cases, and sequencing logic. Add details before starting work, especially for P0 tasks.

**Implementation Progress (Updated):**
- [x] **LangSmith test script** — `npm run test:langsmith` verifies API key + traced call
- [x] **LangChain always used when available** — `medical-coding-service.js` prefers LangChain for tracing
- [x] **LangSmith status in `/health?detailed=true`** — returns `langsmith: { enabled, project, hasKey }`
- [x] **Confidence thresholds** — reject <0.6, escalate 0.6-0.75; `CONFIDENCE_THRESHOLD_LOW`, `CONFIDENCE_THRESHOLD_ESCALATE` env
- [x] **Mandatory validateCodesExist** — `generateCodingSuggestion` and `handleSuggestCodesFromSymptoms` filter invalid codes
- [x] **needs_review / needsReview** — returned when confidence in escalate range
- [x] **Postgres retry queue (Section 2.2)** — `postgres_sync_retry` + `postgres_sync_dlq` tables; `enqueuePostgresSyncRetry` on sync failure; `postgres-sync-worker.js` polls every 60s with exponential backoff (1s,2s,4s,8s,16s), max 5 attempts then DLQ; `retry_queue_depth` + `dlq_size` in `/api/admin/metrics`
- [x] **Idempotency for claims/billing (Section 22)** — `idempotency_keys` table; reserve/complete/release flow; wired into `POST /voice/insurance/submit-claim`, `POST /api/payment/process`, `POST /process-payment`; 24h TTL with daily cleanup; `Idempotency-Key` header or `idempotency_key` body supported
- [x] **LangGraph state flow (Section 26)** — `@langchain/langgraph` + `coding-graph.js`; StateGraph with apply_trigger node; MemorySaver (dev) / PostgresSaver (prod) checkpointer; wired into Retell transcript/function_call handlers; `LANGGRAPH_ROLLOUT_PCT` (0–1) and `LANGGRAPH_SHADOW` for phased rollout; `langgraph_enabled` feature flag (DB/env)
- [x] **Circuit breakers (Section 2.1)** — `utils/circuit-breaker.js`; Stedi (5/60s), Groq (5/60s); fallback to simulation/knowledge-service; metrics in `/api/admin/metrics`
- [x] **Application Insights + correlation ID** — `middleware/application-insights.js`, `middleware/request-context.js`; `APPINSIGHTS_INSTRUMENTATIONKEY`; `x-request-id` per request
- [x] **PII redaction (Section 12)** — `utils/pii-redactor.js`; SSN, DOB, card patterns; applied in `appendConversationMemory`
- [x] **Incident runbooks (Section 20)** — `docs/runbooks/`; STEDI_DOWN, GROQ_RATE_LIMIT, LOW_CONFIDENCE_SPIKE, POSTGRES_SYNC_BACKLOG, ERROR_RATE_SPIKE, DR.md
- [x] **Enhanced health checks (Section 19)** — Dependency probes: Stedi (2s), Groq (3s), FHIR (2s); 30s cache; `dependencies` + `circuit_breaker_states` in `/health?detailed=true`
- [x] **Token budget (Section 10)** — `utils/token-budget.js`; `MAX_TOKENS_PER_CALL` (default 10K); per-call tracker; `canProceed` before Groq; fallback when exceeded; reset on call end; `token_budget` in `/api/admin/metrics`
- [x] **Groq 429 backoff (Section 17)** — Exponential backoff 1s, 2s, 4s; max 3 retries in `medical-coding-service.js`
- [x] **Per-clinic rate limits (Section 17)** — `utils/clinic-rate-limiter.js`; in-memory per-clinic limit (150/min default); applied to `/voice/incoming` and Retell WebSocket; `clinic_rate_limit` in `/api/admin/metrics`
- [x] **P95/P99 latency (Section 3)** — `getLlmUsageAggregates` returns `p95_latency_ms`, `p99_latency_ms`
- [x] **Data retention policy (Section 21)** — `config/retention-policy.js`; `docs/compliance/README.md#data-retention-policy`; `scripts/cleanup-retention.js`
- [x] **Latency budget constants (Section 3)** — `config/latency-budget.js`; per-function budgets; violations in `/api/admin/metrics`
- [x] **Tool handler unit tests (Section 4)** — `tests/tool-handlers/validate-code-pair.test.js`, `suggest-codes.test.js`
- [x] **Cache warming (Section 24)** — `cache-service.warm()`; called on server startup
- [x] **DLQ for tool calls (Section 2)** — `dlq_tool_calls` table; `enqueueToolCallDLQ` on handleFunctionCall failure; `tool-call-dlq-worker.js`; `dlq_tool_calls` in `/api/admin/metrics`; `GET /api/admin/dlq-tool-calls`
- [x] **Graceful Tiba degradation (Section 2)** — `settled: false, manualReview: true` when Stedi fails in `checkEligibility` and `submitClaim`; `stediFallback: true` flag
- [x] **GET /api/admin/dashboards/calls (Section 1)** — Call volume, state transitions, tool usage, error rates over last N days
- [x] **State transitions test (Section 4)** — `tests/state-transitions.test.js` for `computeNextStage`
- [x] **Accuracy evaluation (Section 4)** — `scripts/evaluate-accuracy.js`; voice-agent-test-cases; `npm run test:accuracy`; CI step with `ACCURACY_THRESHOLD`
- [x] **DR runbook enhancements (Section 18)** — RTO/RPO verification; quarterly restore test procedure in `docs/runbooks/README.md#dr`
- [x] **Alert rules config (Section 20)** — `docs/runbooks/README.md#alert-rules`; Azure Monitor rule definitions; alert → runbook mapping
- [x] **Feature flags (Section 15)** — `config/feature-flags.js`, `utils/feature-flags.js`, `feature_flags` table; `GET/POST /api/admin/feature-flags`
- [x] **Context optimization (Section 9)** — `estimateTokens`, `smartTruncate` in context-assembler; dynamic turn limit from tokenBudget
- [x] **voice_call_log.clinic_id (Section 14)** — Migration adds column; populated from customer_id
- [x] **Load test (Section 23)** — `tests/load/basic-load.js`; `npm run test:load`
- [x] **Contract tests (Section 4)** — `tests/contract/stedi-mock.test.js`; `npm run test:contract`

### Gap Analysis Addendum (Jan 2025)

**Verified as already implemented:**
- `coding-graph.js` exists with LangGraph StateGraph, MemorySaver, dual-write
- `medical-text-extraction-service.js` exists, exports `extractStructuredData`
- PII redaction applied in `appendConversationMemory` (database.js)
- Triage service loads `triage-rules.json`, has `detectRedFlags`, `checkBeforeScheduling`
- Knowledge files exist: `extraction-patterns.json`, `medical-entities.json`, `medical-abbreviations.json`, `severity-indicators.json`, `triage-rules.json`
- Circuit breakers wired in ehr-aggregator (1upHealth), epic-adapter (Epic), uhc-fhir-service (FHIR), insurance-service (Stedi), medical-coding-service (Groq)

**Implemented in this pass:**
- **LangGraph single-path** — retell-websocket uses LangGraph as primary when enabled, falls back to `processCodingStateTurn` on failure; transcript and function_call handlers await LangGraph; DLQ on transcript failure
- **Context assembler smartTruncate** — `assembleContext` now applies `smartTruncate` to `currentQuery` (30% budget), dynamic turn limit from remaining budget, returns `truncatedQuery`, `tokensUsed`, `budgetRemaining`
- **Token budget in suggest_codes** — `handleSuggestCodesFromSymptoms` checks `canProceed` before getCodeCandidates; disables semantic search when over budget; tracks tokens after call

**P0/P1/P2 addendum (Jan 2025):**
- **LangSmith mandatory in prod** — `langsmith-config.js` warns/fails when `LANGSMITH_API_KEY` missing in production; `LANGSMITH_MANDATORY=true` for hard fail; health check degraded when tracing off
- **Chat LLM + Admin AI through LangChain** — `chat-llm-service.js` uses ChatGroq when available; admin-ai-assistant uses ChatLLMService (traced)
- **Postgres checkpointer** — `@langchain/langgraph-checkpoint-postgres`; `coding-graph.js` uses PostgresSaver when `POSTGRES_URL` + production or `LANGGRAPH_USE_POSTGRES=true`
- **Medical coding tags** — `clinic_id`, `call_id`, `operation` added to LangSmith traces
- **OpenAIEmbeddings in semantic-search** — `semantic-search-service.js` uses `@langchain/openai` when available for embedding traces
- **langgraph_enabled feature flag** — `shouldUseLangGraph(callId, clinicId)` checks `utils/feature-flags`
- **Reconciliation script** — `scripts/reconcile-langgraph-state.js`; `npm run reconcile:langgraph`
- **Migration script** — `scripts/migrate-to-langgraph.js`; `npm run migrate:langgraph`

---

## 1. Monitoring & Observability

### Current State
- Basic `console.log`/`console.error` logging
- `/health` and `/health?detailed=true` endpoints (`middleware/health-check.js`)
- `/api/admin/metrics` (LLM aggregates, cache stats)
- `llm_usage_log` table with tokens, cost, latency, confidence
- `middleware/error-handler.js` logs errors to DB (`db.logError`) and console
- **No** Application Insights, structured logging with correlation IDs, real-time alerts, or call-flow dashboards

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `applicationinsights` package | `middleware-platform/package.json` | Enables Azure Application Insights SDK |
| Create `middleware/application-insights.js` | New file | Init App Insights with `APPINSIGHTS_INSTRUMENTATIONKEY`; auto-tracks HTTP requests, exceptions, dependencies |
| Add correlation ID middleware | `middleware-platform/server.js` or `middleware/request-context.js` | Generate `x-request-id` per request; attach to `req.id`; log in structured JSON `{ requestId, path, method, ... }` |
| Extend `retell-websocket.js` | WebSocket handlers | Add `callId` and `clinic_id` to all log entries so Retell → middleware flows are traceable |
| Add `GET /api/admin/dashboards/calls` (or extend metrics) | `server.js` | Return call volume, state transitions, tool usage, error rates over last N days |
| Wire App Insights in `server.js` | Top of `server.js` | `require('./middleware/application-insights')` before other middleware |

**Impact:** Full trace Retell → middleware → FHIR → Tiba → Stedi; structured logs for log aggregation; dashboards for ops; real-time alerts when configured in Azure.

---

## 2. Error Handling & Resilience

### Current State
- `middleware/error-handler.js`: `asyncHandler`, `withRetry`, `withTimeout`, circuit breaker (100 errors/min)
- Postgres sync: `.catch()` logs only; **TODOs** for retry queue (database.js lines 168, 255, 313, 359, 393)
- Stedi: 30s timeout, fallback to simulation on failure; **no** circuit breaker per service
- 1upHealth / Epic / FHIR: **no** circuit breakers or retry queues

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `postgres_sync_retry` table | `database.js` | Store failed sync payloads (entity_type, payload_json, created_at) for retry |
| Create `services/postgres-sync-queue.js` | New file | Poll table every 60s; retry with exponential backoff; delete on success; limit 5 retries |
| Replace `.catch()` in sync fns | `database.js` | On Postgres failure, insert into `postgres_sync_retry` instead of only logging |
| Create `utils/circuit-breaker.js` | New file | Per-service circuit breaker: open after N failures in window; half-open to probe |
| Wrap Stedi, 1upHealth, Epic clients | `insurance-service.js`, `uhc-fhir-service.js`, `ehr-sync-service.js` | Use `CircuitBreaker.execute(() => apiCall)` |
| Add dead letter queue for tool calls | `retell-websocket.js` | On `handleFunctionCall` failure, push to `dlq_tool_calls` table; background job retries or alerts |
| Graceful degradation for Tiba | EOB/Settlement flows | If Tiba/Stedi down: log, return `{ settled: false, manualReview: true }`, do not block call |

**Impact:** Resilient to external API outages; no lost Postgres syncs; failed tool calls auditable and retriable.

### 2.1 Circuit Breaker Configuration

| Setting | Stedi | 1upHealth | Groq |
|---------|-------|-----------|------|
| Failure threshold | 5 failures in 60s | 3 failures in 30s | 5 failures in 60s |
| Reset time (half-open) | 30s | 30s | 30s |
| Fallback | Simulated eligibility + alert | Return cached/error | knowledge-service fallback |

**Metrics:** Track `circuit_breaker_trips`, `circuit_breaker_state` (closed/open/half-open), `fallback_invocations` in `/api/admin/metrics`. **Alert:** Page if Stedi circuit open >5 min.

```javascript
// utils/circuit-breaker.js
class CircuitBreaker {
  constructor(name, { failureThreshold = 5, windowMs = 60000, resetTimeMs = 30000 }) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.resetTimeMs = resetTimeMs;
    this.failures = [];
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }
  async execute(fn, fallback) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeMs) this.state = 'HALF_OPEN';
      else return fallback ? fallback() : Promise.reject(new Error('Circuit open'));
    }
    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') { this.state = 'CLOSED'; this.failures = []; }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  recordFailure() {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter(t => now - t < this.windowMs);
    if (this.failures.length >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastFailureTime = now;
      // TODO: Alert/metric
    }
  }
}
```

### 2.2 Postgres Retry Queue Implementation

| Setting | Value |
|---------|-------|
| Priority | `priority` column: 1=high, 2=medium, 3=low; retry high first |
| Exponential backoff | 1s, 2s, 4s, 8s, 16s; max 5 attempts |
| Max retries | After 5 failures → move to `postgres_sync_dlq` |
| Worker | Poll every 60s; process batches of 10 |
| Metrics | `retry_queue_depth`, `retry_success_rate`, `dlq_size` |

**Schema:** `postgres_sync_retry(id, entity_type, payload_json, priority, attempt_count, last_error, last_attempt_at, created_at)`. `postgres_sync_dlq` for permanently failed syncs.

---

## 3. Latency SLAs

### Current State
- No per-stage timeouts or budgets
- `llm_usage_log` stores `latency_ms` per Groq call
- No P95/P99 tracking in metrics

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `LATENCY_BUDGET_MS` constants | `services/coding-state-service.js` or config | e.g. `CODING: 3000`, `VALIDATION: 1500`, `TRIAGE: 2000` |
| Wrap tool handlers with timer | `retell-websocket.js` | Before/after each handler; if `latency > budget`, log warning and set `over_budget: true` in response metadata |
| Add `latency_budget_violations` to metrics | `server.js` `/api/admin/metrics` | Query `function_call_log` or new `latency_log` for over-budget counts |
| Compute P95/P99 in `getLlmUsageAggregates` | `database.js` | Add `p95_latency_ms`, `p99_latency_ms` to aggregates |
| Async FHIR writes | `fhir-service.js` | For non-critical writes (e.g. observation), `setImmediate` or queue to avoid blocking voice response |

**Impact:** Identify slow stages; enforce budgets; optimize hot paths.

---

## 4. Automated Testing

### Current State
- `tests/eob-calculation.test.js`, `tests/medical-coding/` exist
- No unit tests per tool handler; no integration tests for state transitions; no regression suite on deploy

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `tests/tool-handlers/` | New dir | Unit tests for `handleValidateCodePair`, `handleSuggestCodesFromSymptoms`, `handleCheckPayerGuidelines`, etc. |
| Add `tests/state-transitions.test.js` | New file | Test `coding-state-service.computeNextStage` for all function → stage mappings |
| Add `scripts/evaluate-accuracy.js` | New file | Load `tests/medical-coding/voice-agent-test-cases.json`; run coding pipeline; compare expected vs actual; output accuracy % |
| Add CI step | `.github/workflows/ci.yml` | Run `node scripts/evaluate-accuracy.js` on every deploy; fail if accuracy drops below threshold |
| Contract tests for Stedi/Retell | `tests/contract/` | Mock external APIs; assert request/response shape; run in CI |

**Impact:** Catch regressions before production; baseline accuracy tracking.

---

## 5. Confidence Thresholds & Escalation

### Current State
- `computeOverallConfidence` in `medical-coding-service.js`; scores logged in `llm_usage_log`
- Chat commands use threshold 0.5 (0.3 for help)
- **No** auto-reject or human escalation for medical coding

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `CONFIDENCE_THRESHOLD_LOW` (0.6), `CONFIDENCE_THRESHOLD_ESCALATE` (0.75) | Config or `medical-coding-service.js` | Constants for rejection and escalation |
| In `generateCodingSuggestion` | `medical-coding-service.js` | If `codingConfidence < 0.6`: return `{ rejected: true, reason: 'low_confidence', escalateToHuman: true }` |
| In `handleSuggestCodesFromSymptoms` | `retell-websocket.js` | If any suggested code has confidence < 0.6, add `needs_review: true` to response |
| Add `coding_decisions.escalation_status` | `database.js` | `'auto_approved' | 'escalated' | 'rejected'` |
| Track rejection rate in metrics | `/api/admin/metrics` | `rejection_rate`, `escalation_rate`; alert if >10% |

**Impact:** Low-confidence codes never auto-applied; human review queue for edge cases.

---

## 6. Hallucination Prevention

### Current State
- `validateCodesExist` in `knowledge-service.js` (checks DB)
- `handleValidateCodePair` uses `db.codeExists` before pair check
- `suggest_codes_from_symptoms` returns codes from `getCodeCandidates` (KB search)—codes exist by construction
- **No** mandatory validation before every code return; **no** semantic similarity check vs diagnosis

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Mandatory `validateCodesExist` before return | `handleSuggestCodesFromSymptoms`, `generateCodingSuggestion` (PDF coding) | Filter out any code not in KB; if all filtered, return empty + `validated: true` |
| Add `validateBeforeReturn` in knowledge-service | `knowledge-service.js` | Wrapper: given `{ icd10: [], cpt: [] }`, return only codes that exist; add `invalid_codes: []` to response |
| Optional: semantic similarity | New fn in `knowledge-service.js` | Compare suggested code description to diagnosis text; flag if similarity < 0.5 (requires embeddings) |
| Log invalid codes | `coding_decisions` or `llm_usage_log` | Store `invalid_codes` for anomaly detection |

**Impact:** No hallucinated codes reach agent or patient; audit trail for model drift.

---

## 7. LiveKit Agent (Video Integration)

### Current State
- Retell uses LiveKit as SIP backend for telephony
- **No** LiveKit Agent as media client; **no** video pass-through

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `@livekit/agents` package | `package.json` | LiveKit Agents SDK |
| Create `services/livekit-agent-service.js` | New file | Connect to LiveKit room; receive audio; call same tool handlers (HTTP or shared module); stream TTS back |
| Standardize tool interface | `webhooks/tool-handlers.js` (new or refactored) | Extract `handleValidateCodePair`, `handleSuggestCodesFromSymptoms`, etc. into HTTP-callable module; Retell + LiveKit both call same endpoints |
| Document in MEDIA_LAYER_ARCHITECTURE | `docs/architecture/README.md#media-media-layer-architecture` | Add LiveKit Agent flow: audio → middleware → tools → TTS → room |

**Impact:** Reuse middleware brain for video; consistent tool behavior across voice and video.

---

## 8. Long-Term Memory

### Current State
- `voice_conversation_memory` with 30-day retention (configurable)
- **No** patient coding history; **no** provider preference patterns; **no** aggregate stats for confidence tuning

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `patient_coding_history` table | `database.js` | `patient_id`, `encounter_id`, `icd10`, `cpt`, `confidence`, `created_at` |
| Add `provider_preferences` table | `database.js` | `provider_id`, `preference_key` (e.g. `modifier_25_default`), `value`, `updated_at` |
| Persist coding decisions by patient | `insertCodingDecision` | Also upsert into `patient_coding_history` when `patient_id` available |
| Add `getPatientCodingHistory(patientId)` | `knowledge-service.js` or new service | Retrieve prior codes for context |
| Aggregate confidence stats | Batch job or on-demand | Compute per-clinic, per-code acceptance rates for model tuning |

**Impact:** Richer context for coding; personalization; data for confidence calibration.

---

## 9. Context Window Optimization

### Current State
- `context-assembler-service.js`: `MAX_CONVERSATION_TURNS=10`, `MAX_ICD10_CANDIDATES=20`, etc.
- `medical-coding-service.js`: `MAX_NOTE_LENGTH=4000` truncation (tail)
- **No** smart truncation (keep diagnosis, drop chitchat); **no** dynamic turn limit; **no** summarization of older turns

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `smartTruncate(transcript)` | `context-assembler-service.js` | Prefer segments with medical keywords; drop greetings/closings; cap by token estimate |
| Add `estimateTokens(text)` | Util | Rough 4 chars/token for LLM |
| Dynamic turn limit | `assembleContext` | `maxTurns = min(10, tokenBudget / avgTurnTokens)` |
| Optional: summarize older turns | `context-assembler-service.js` | If turns > 5, use short Groq call to summarize turns 1–5; keep 6–10 verbatim |

**Impact:** Better use of context window; more room for relevant clinical content.

---

## 10. Token Budget & Cost Control

### Current State
- `llm_usage_log` tracks tokens and cost per Groq call
- `/api/admin/metrics` aggregates
- **No** per-call budget; **no** monthly caps per clinic; **no** Groq vs OpenAI comparison

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `MAX_TOKENS_PER_CALL` (e.g. 10000) | Config | Reject or truncate if call would exceed |
| Check token budget before Groq call | `medical-coding-service.js` | If `callTokensSoFar + estimatedTokens > budget`, return fallback or truncate |
| Add `clinic_monthly_llm_cost` table or column | `database.js` | Track spend per clinic per month |
| Add `monthly_cost_cap` to clinics | `clinics` table | Alert or block when exceeded |
| Add cost comparison to metrics | `/api/admin/metrics` | `groq_cost_7d`, `openai_cost_7d` (embeddings) |

### 10.1 Token Budget Enforcement

| Task | Details |
|------|---------|
| **Per-call tracker** | In-memory map: `callId → tokensUsed`; increment on each LLM call |
| **Pre-check** | Before Groq call: `tokensUsed + estimatedTokens < MAX_TOKENS_PER_CALL` |
| **Graceful degradation** | If budget exceeded: skip embeddings, keyword search only, cached response |
| **Reset** | Clear `tokensUsed` when call ends (Retell webhook) |
| **Abuse alert** | If call uses >50K tokens, alert for review |

**Risk:** Runaway token usage without budget enforcement.

---

## 11. Semantic Search at Scale

### Current State
- `semantic-search-service.js`: optional; requires `OPENAI_API_KEY` + populated `code_embeddings`
- `hybridSearch` merges keyword + semantic when `useSemantic: true`
- **No** auto-populate on code DB updates; **no** batch embedding job; **no** vector DB

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `scripts/populate-code-embeddings.js` | New file | Iterate `icd10_codes`, `cpt_codes`, `hcpcs_codes`; call `embedText`; insert into `code_embeddings` |
| Add nightly job or webhook | CI / cron / `database.js` migration hook | On code table change, queue embedding refresh for new/changed codes |
| Make hybrid search default | `knowledge-service.getCodeCandidates` | Set `useSemantic: true` when embeddings exist |
| Optional: Pinecone/Chroma | `semantic-search-service.js` | Offload vector search for sub-100ms retrieval at scale |

**Impact:** Better code retrieval; hybrid search by default when embeddings populated.

---

## 12. PII Handling

### Current State
- API key encryption in `utils/api-keys.js`
- **No** SSN/DOB/card redaction before storage; **no** transcript encryption at rest; **no** HIPAA audit log for access

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `utils/pii-redactor.js` | New file | Redact SSN (`\d{3}-\d{2}-\d{4}`), DOB patterns, card numbers before writing to `voice_conversation_memory`, transcripts |
| Apply redactor before DB insert | `appendConversationMemory`, transcript storage | Redact `content` in memory; store redacted version |
| Encrypt transcripts at rest | `database.js` | Use `API_KEY_ENCRYPTION_KEY` or new `TRANSCRIPT_ENCRYPTION_KEY`; encrypt before insert, decrypt on read |
| Add `hipaa_access_log` table | `database.js` | `user_id`, `resource_type`, `resource_id`, `action`, `timestamp` |
| Log access in FHIR/patient routes | Routes that return PHI | Insert into `hipaa_access_log` |
| Auto-expire PII | Batch job | After claim adjudicated (e.g. 90 days), null out or encrypt transcript content |

### 12.1 PII Redaction Edge Cases

| Pattern | Regex / Logic | Notes |
|---------|---------------|-------|
| SSN | `\d{3}-\d{2}-\d{4}` | Standard US |
| DOB | `(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](\d{4}|\d{2})` | MM/DD/YYYY |
| Credit card | `\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}` | 4×4 digits |
| NHS (UK) | `\d{3}\s\d{3}\s\d{4}` | UK national number |
| MRN | `(MRN\|mrn\|medical record number)[:\s]+(\d{6,10})` | Medical record number |
| Patient names | `(Mr\.\|Mrs\.\|Ms\.\|Dr\.\|patient)\s+([A-Z][a-z]+(\s[A-Z][a-z]+)?)` | Fuzzy; high false-positive risk; use cautiously |
| Redaction log | `pii_redaction_log` | Log counts by type for audit; not content |

**Risk:** Incomplete redaction → HIPAA violation. False positives → loss of clinical context.

---

## 13. Authentication & Authorization

### Current State
- API key auth for external APIs; session/auth for provider portal
- **No** RBAC (admin vs clinic staff vs patient); **no** API key rotation; **no** OAuth for EHR

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `roles` and `permissions` | `users` table or new `user_roles` | `admin`, `clinic_staff`, `patient`; map to permission sets |
| Middleware `requireRole(['admin'])` | `routes/` | Check `req.user.role` before sensitive endpoints |
| API key rotation | `merchant_api_keys` / `api-keys.js` | Add `rotateApiKey(merchantId)`; generate new, revoke old, return new key |
| OAuth for EHR | `ehr_connections`, routes | Store client_id/secret; implement auth code flow for Epic/1upHealth |

**Impact:** Least-privilege access; auditability; EHR integration ready.

---

## 14. Multi-Tenancy / Schema Normalization

### Current State
- `voice_call_log.customer_id` stores `clinic_id` (documented as schema limitation)
- `clinics` and `customers` both exist; `customers` used for legacy
- Tenant resolution via `clinic_id` in Retell dynamic variables

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `voice_call_log.clinic_id` column | Migration in `database.js` | Populate from `customer_id` where customer_id was clinic_id |
| Deprecate `customer_id` for voice | `retell-websocket.js`, docs | Prefer `clinic_id`; keep `customer_id` for backward compat during transition |
| Tenant-scoped queries | All multi-tenant queries | Ensure `WHERE clinic_id = ?` in `getAppointments`, `getCodingDecisions`, etc. |
| Per-tenant config table | `database.js` | `clinic_settings` (clinic_id, key, value) for custom rules, payer preferences |

**Impact:** Clear tenant model; no cross-clinic data leaks.

---

## 15. Deployment & Rollback

### Current State
- PM2, Azure App Service
- **No** blue-green; **no** feature flags; **no** automated DB migrations with rollback; **no** canary

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add feature flags | `config/feature-flags.js` | `semantic_search_enabled`, `confidence_rejection_enabled`; read from env or DB |
| Use flags in code | `knowledge-service.js`, `medical-coding-service.js` | Check before enabling new behavior |
| Migration rollback scripts | `scripts/migrations/` | Each migration has `up` and `down`; `npm run migrate:down` |
| Document blue-green | `docs/deployment/` | Use Azure deployment slots; swap after validation |
| Canary release doc | `docs/deployment/` | Route 5% traffic to new slot; monitor errors/latency; full cutover |

### 15.1 Feature Flag Gradual Rollout

| Task | Details |
|------|---------|
| **Flag storage** | `feature_flags` table: `flag_name`, `enabled_globally`, `enabled_for_clinic_ids` (JSON), `rollout_pct` |
| **Flag service** | `utils/feature-flags.js`: `isEnabled(flagName, clinicId, callId)` checks DB with 60s cache |
| **Remote override** | `POST /api/admin/feature-flags` to toggle without deploy |
| **Rollout** | `rollout_pct=25` → hash(callId) % 100 < 25 gets feature |

---

## 16. Documentation

### Current State
- README, architecture docs, RUNBOOK
- **No** OpenAPI spec; **no** runbooks for Stedi/Groq incidents

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Generate OpenAPI spec | `docs/api/openapi.yaml` or swagger-jsdoc | Document `/api/*` routes, request/response schemas |
| Add runbooks | `docs/runbooks/` | `STEDI_DOWN.md`, `GROQ_RATE_LIMIT.md`, `LOW_CONFIDENCE_SPIKE.md` with steps |
| Update architecture diagrams | `docs/architecture/` | Add sequence diagrams for Retell → middleware → Tiba; state flow |

**Impact:** Easier onboarding; faster incident response.

---

## 17. Rate Limiting & Abuse Prevention

### Current State
- `middleware/rate-limiter.js` exists for API/auth/payment/voice endpoints
- **No** per-clinic limits; **no** Groq 429 handling with backoff

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `express-rate-limit` | `server.js` | Per-IP limits (e.g. 100 req/min); return 429 when exceeded |
| Per-clinic rate limits | Middleware | Track Retell webhook calls per `clinic_id` in Redis or memory; throttle runaway clinics |
| Groq rate limit handling | `medical-coding-service.js` | Catch 429 errors; exponential backoff retry; alert if sustained (e.g. 5 consecutive) |

**Impact:** Prevent cost spikes from runaway calls; protect against abuse.

---

## 18. Backup & Disaster Recovery

### Current State
- Automated backups referenced in docs; no documented restore procedure
- **No** quarterly restore test; **no** explicit RTO/RPO targets

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Configure automated Postgres backups | Azure/config | Daily backups; 30-day retention; point-in-time recovery enabled |
| Create `docs/runbooks/README.md#dr` | New file | Steps to restore from backup; RTO/RPO targets; contact escalation |
| Add to ops calendar | Ops process | Test restore quarterly; verify backups are usable |

**Impact:** Data durability; business continuity.

---

## 19. Enhanced Health Checks

### Current State
- `/health` and `/health?detailed=true` in `middleware/health-check.js` (DB, memory, disk)
- `/health/ready` and `/health/live` mentioned in RELIABILITY.md
- **No** dependency checks (Stedi, Groq, FHIR)

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Extend `/health?detailed=true` | `middleware/health-check.js` | Add dependency checks: ping Stedi, Groq, FHIR, DB; return status per service |
| Enhance `/health/ready` (exists) | Health check | `ready` = can accept traffic (DB + critical deps OK); `live` = process running (minimal) |
| Document in deployment guide | `docs/deployment/` | Kubernetes-style probe configuration |

### 19.1 Health Check Dependency Probes

| Setting | Value |
|---------|-------|
| Timeouts | Stedi: 2s; Groq: 3s; DB: 1s; FHIR: 2s |
| Caching | Cache dependency status 30s; return cached if fresh |
| Parallel checks | `Promise.allSettled` — check all deps in parallel |
| Partial degradation | If Stedi down but DB up → `status: 'degraded'` (not unhealthy) |

**Risk:** Health check hangs if Stedi slow → load balancer marks instance unhealthy.

---

## 20. Alerting Thresholds & Channels

### Current State
- No defined alert rules; no configured channels
- **No** runbook links in alert metadata

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Define alert rules | Application Insights or config | Error rate >5%, latency P95 >3s, rejection rate >10%, Stedi circuit open |
| Configure channels | Azure Monitor | Email, Slack, PagerDuty for P0 alerts |
| Add runbook links to alerts | Alert metadata | "Stedi down? See docs/runbooks/README.md#stedi-down" |

### 20.1 Alert → Runbook Mapping

| Alert | Threshold | Runbook |
|-------|-----------|---------|
| Stedi circuit open | >5 min | `docs/runbooks/README.md#stedi-down` |
| Groq rate limit | 5 consecutive 429s | `docs/runbooks/README.md#groq-rate-limit` |
| Low confidence spike | >10% rejected | `docs/runbooks/README.md#low-confidence-spike` |
| Postgres sync queue depth | >100 pending | `docs/runbooks/README.md#postgres-sync-backlog` |
| Error rate spike | >5% | `docs/runbooks/README.md#error-rate-spike` |

**Runbook template** (create `docs/runbooks/` and populate):

```markdown
# [Alert Name - e.g. Stedi API Down]

## Symptoms
- [What you see: circuit breaker open, errors in logs, etc.]

## Impact
- [Degraded eligibility, blocked claims, etc.]

## Diagnosis
1. Check [status page / health endpoint]
2. Check Application Insights for [errors]
3. Verify [dependency] in /health?detailed=true

## Mitigation
1. [Notify clinic staff]
2. [Fallback already enabled: simulation / cached]
3. [Queue for retry when recovered]

## Resolution
1. When [service] recovers, circuit auto-closes
2. Retry queued items: `node scripts/retry-queued-claims.js`
3. Verify accuracy returns to normal

## Prevention
- [Monitor SLA, consider backup provider]
```

---

## 21. Data Retention & Archival

### Current State
- No documented retention policy; no archival process

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add retention policy | `database.js` or config | `voice_call_log`: 1 year; `coding_decisions`: 7 years (billing); `llm_usage_log`: 90 days |
| Archive old data | Batch job or Azure Table Storage | Move to cold storage after retention; keep for compliance |
| Document in policy | `docs/compliance/` | Retention by data type; legal hold procedures |

**Impact:** Manage DB growth; compliance with billing regulations.

---

## 22. Idempotency for Critical Operations

### Current State
- **No** idempotency keys on claim submission or payment flows
- Retries could cause double-billing

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `idempotency_key` to claims | Tiba/settlement service, database | Client-provided or generated; dedup claim submissions |
| Check before Stripe charge | Payment flows | If idempotency key seen, return cached result instead of double-charging |
| Add `idempotency_keys` table | `database.js` | Store key, operation_type, result_hash, created_at; TTL 24h |

### 22.1 Idempotency Key Expiration

| Task | Details |
|------|---------|
| **TTL** | Keys valid 24h; expire after |
| **Cleanup job** | Daily cron: `DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'` |
| **Index** | `CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at)` |

**Risk:** Table grows unbounded without cleanup.

---

## 23. Load Testing

### Current State
- No load tests; no capacity baseline

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Add `tests/load/` | New dir | k6 or Artillery scripts; simulate 100 concurrent voice calls |
| Measure latency, error rate, DB saturation | Load test assertions | Establish baseline; fail if regressions |
| Run before major releases | CI | Catch performance regressions |

### 23.1 Load Testing Scenarios

| Scenario | Load | Acceptance Criteria |
|----------|------|---------------------|
| Normal traffic | 100 concurrent, 4 min avg | Error <1%, P95 <3s, DB connections <50 |
| Spike traffic | 500 concurrent, 1 min burst | Error <5%, P95 <5s, circuits trip gracefully |
| Sustained high | 200 concurrent, 1 hour | No memory leaks, error <2%, stable latency |
| PDF coding batch | 100 PDFs parallel | P95 <10s, Groq rate limit not hit, queue <10 |

---

## 24. Cache Warming

### Current State
- `cache-service.js` and `payer-cache-service.js` exist
- **No** warm-on-startup; **no** periodic refresh for code cache

### Required Code Changes

| Change | Location | What It Does |
|--------|----------|--------------|
| Warm cache on startup | `server.js` or background job | Pre-load top 1000 ICD-10/CPT codes into memory cache |
| Refresh periodically | Every 6 hours | Keep cache hot for common codes |
| Add `cacheService.warm()` | `cache-service.js` | Populate from knowledge-service; expose stats |

**Impact:** Faster first response; consistent performance.

---

## 25. LangChain + LangSmith Tracing — MUST HAVE

### Current State
- `@langchain/groq` and `@langchain/core` installed
- LangChain used **optionally** in `medical-coding-service.js`: only when `LANGSMITH_API_KEY`/`AP_Langchain` and `LANGCHAIN_TRACING_V2=true` are set
- When keys are missing, falls back to raw Groq SDK — **no traces**, no tracking
- Admin AI, chat LLM, and other LLM callers may not use LangChain at all

### Required Code Changes (MANDATORY)

| Change | Location | What It Does |
|--------|----------|--------------|
| **Require LangSmith keys at startup** | `medical-coding-service.js`, `server.js` | If `LANGSMITH_API_KEY`/`AP_Langchain` missing in production, log error and refuse to start (or degrade with clear warning) |
| **Always use LangChain for Groq** | `medical-coding-service.js` | Remove fallback to raw SDK; always use `ChatGroq` when Groq is used — traces go to LangSmith |
| **Route all LLM calls through LangChain** | `admin-ai-assistant-service.js`, `chat-llm-service.js`, etc. | Ensure every LLM invocation uses a LangChain model so it appears in LangSmith |
| **Add `LANGCHAIN_TRACING_V2=true` to required env** | `.env.example`, deployment docs | Document as required; fail health check if tracing disabled in prod |
| **Add LangSmith status to `/health?detailed=true`** | `middleware/health-check.js` | Return `langsmith: { enabled: boolean, project: string }` — alert if disabled |

**Impact:** All LLM calls traceable in LangSmith; latency, tokens, errors, and prompts visible for debugging and auditing. **Without this, you cannot track.**

### 25.1 LangSmith Project Organization

| Task | Details |
|------|---------|
| **Project naming** | `LANGCHAIN_PROJECT=middleware-{env}` (e.g. `middleware-prod`, `middleware-staging`) |
| **Tag strategy** | Tag traces with `clinic_id`, `call_id`, `operation` (e.g. `pdf_coding`, `voice_triage`) |
| **Retention** | LangSmith free: 14 days; paid: 1 year. Document archival plan |
| **PHI controls** | Traces may contain PHI — restrict access; redact before logging if possible |
| **Cost** | ~$39/mo for 1M traces; monitor usage |

---

## 26. LangGraph State Flow — MUST HAVE

### Current State
- Custom `coding-state-service.js` with hand-rolled state machine (INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING)
- No LangGraph; no built-in persistence to LangSmith; no graph visualization or trace of state transitions
- State persisted in `voice_call_states` table but not integrated with tracing

### Required Code Changes (MANDATORY)

| Change | Location | What It Does |
|--------|----------|--------------|
| **Add `@langchain/langgraph`** | `package.json` | LangGraph package for state machine as a graph |
| **Create LangGraph state graph** | `services/coding-graph.js` (new) | Define `StateGraph` with nodes: `intake`, `extract`, `triage`, `coding`, `validate`, `billing`; edges from triggers (transcript, function_call) |
| **Integrate with LangSmith** | LangGraph config | Use `checkpointer` + LangSmith tracer so every state transition is traced and visible |
| **Wire Retell handlers to graph** | `retell-websocket.js` | On transcript or function_call, invoke graph `invoke()` instead of `processCodingStateTurn`; graph drives next step |
| **Persist graph state** | `voice_call_states` or LangGraph checkpointer | Store state after each step; enable "continue conversation" and audit trail |
| **Migrate from coding-state-service** | Refactor | Replace `computeNextStage` usage with LangGraph; keep `STAGES`/`FUNCTION_TO_STAGE` as reference during migration |

**Impact:** Full state flow visible in LangSmith; each transition (INTAKE→EXTRACTION→CODING etc.) traced with inputs/outputs; graph visualization; audit trail for compliance. **Without this, you cannot track state flow.**

### 26.1 State Synchronization (LangGraph ↔ Database)

| Task | Location | Details |
|------|----------|---------|
| **Dual-write during migration** | `coding-graph.js` | Write to both LangGraph checkpointer AND `voice_call_states` during transition |
| **State reconciliation** | Background job | Compare LangGraph checkpointer vs DB; alert on divergence |
| **Migration script** | `scripts/migrate-to-langgraph.js` | Load existing `voice_call_states` → seed LangGraph checkpointer |
| **Rollback plan** | Runbook | If LangGraph fails, fall back to `coding-state-service.js`; define criteria |
| **Checkpointer** | Config | Use `@langchain/langgraph-checkpoint-postgres` or memory; document tradeoffs |

**Risk:** Without this, orphaned state in DB and LangGraph won't resume conversations.

### 26.2 LangGraph Migration Strategy (Phased Rollout)

| Phase | Duration | Tasks |
|-------|----------|-------|
| **Phase 0: Prep** | Week 1 | Install `@langchain/langgraph`, create `coding-graph.js`, unit tests |
| **Phase 1: Shadow** | Week 2 | Run LangGraph in parallel with `coding-state-service`; compare outputs; fix divergence |
| **Phase 2: Canary** | Week 3 | Route 10% of calls to LangGraph (env `LANGGRAPH_ROLLOUT_PCT=0.1`); monitor errors |
| **Phase 3: Ramp** | Week 4 | 50% LangGraph; measure latency, accuracy |
| **Phase 4: Full** | Week 5 | 100% LangGraph; deprecate `coding-state-service.js` |
| **Phase 5: Cleanup** | Week 6 | Remove old code; archive `voice_call_states` data |

**Rollback criteria:** Error rate >5%; P95 latency >4s; state divergence >1%.

---

## Implementation Priority Matrix (Revised)

| Priority | Category | Effort | Impact | Notes |
|----------|----------|--------|--------|-------|
| **P0** | **25. LangChain + LangSmith** | Low | High | **MUST HAVE — tracking** |
| **P0** | **26. LangGraph state flow** | Medium | High | **MUST HAVE — state tracking** |
| **P0** | 2. Postgres retry queue | Medium | High | Data integrity |
| **P0** | 5. Confidence thresholds | Low | High | Quality gate |
| **P0** | 6. Mandatory validateCodesExist | Low | High | Prevent hallucinations |
| **P0** | 22. Idempotency (claims/billing) | Low | High | Prevent double-charges |
| **P1** | 1. Application Insights + correlation ID | Medium | High | Observability |
| **P1** | 2. Circuit breakers | Medium | High | Resilience |
| **P1** | 12. PII redaction | Medium | High | HIPAA compliance |
| **P1** | 17. Rate limiting | Low | High | Cost control |
| **P1** | 18. Backup & DR | Low | High | Business continuity |
| **P1** | 21. Data retention policy | Low | Medium | Compliance, DB growth |
| **P2** | 3. Latency budgets + P95/P99 | Low | Medium | Performance |
| **P2** | 4. Tool handler unit tests | Medium | Medium | Quality |
| **P2** | 10. Token budget + cost caps | Low | Medium | Cost control |
| **P2** | 11. Populate embeddings + hybrid | Medium | Medium | Search quality |
| **P2** | 19. Enhanced health checks | Low | Medium | Ops |
| **P2** | 20. Alerting | Low | High | Incident response |
| **P3** | 8. Long-term memory | Medium | Medium | Personalization |
| **P3** | 9. Smart truncation | Medium | Low | Optimization |
| **P3** | 14. clinic_id migration | Low | Medium | Schema clarity |
| **P3** | 15. Feature flags | Low | Medium | Safe rollouts |
| **P3** | 16. OpenAPI + runbooks | Medium | Low | Documentation |
| **P3** | 23. Load testing | Medium | Medium | Capacity planning |
| **P3** | 24. Cache warming | Low | Low | Performance |

---

## Quick Wins for Immediate Impact

*If starting this week — **LangChain + LangSmith first** (required for tracking):*

| # | Item | Priority | Est. Effort | Impact |
|---|------|----------|-------------|--------|
| 1 | **LangChain + LangSmith (mandatory)** | P0 | 1 day | **MUST HAVE** — enables LLM call tracking |
| 2 | **Mandatory code validation** | P0 | 1 day | Prevents hallucinations now |
| 3 | **Confidence thresholds** | P0 | 1 day | Quality gate |
| 4 | **Rate limiting** | P1 | 1 day | Prevents cost spikes |
| 5 | **PII redaction regex** | P1 | 2 days | Start HIPAA compliance |
| 6 | **LangGraph** (after LangChain) | P0 | 2–3 days | **MUST HAVE** — enables state flow tracking |
| 7 | **Application Insights** | P1 | 1 day | Observability foundation |

---

## LangChain + LangSmith — MUST HAVE (Current vs Target)

| Aspect | Current | Target |
|--------|---------|--------|
| **Status** | Optional — falls back to raw SDK if keys missing | **Mandatory** — fail or warn if keys missing in prod |
| **AP_Langchain** | Used as `LANGSMITH_API_KEY` when present | Keep; require in production |
| **LANGCHAIN_TRACING_V2** | Set to `true` when key present | Always `true` in prod; health check verifies |
| **Scope** | PDF coding (Groq) only | **All** middleware LLM calls (Groq, admin AI, chat, etc.) |
| **Verification** | Manual: trigger PDF coding, check LangSmith | `/health?detailed=true` returns `langsmith.enabled`; alert if false |

**Note:** Retell's voice LLM is hosted by Retell and not traceable in our LangSmith. LangChain/LangSmith covers middleware-side LLM usage (PDF coding, admin AI, chat, coding suggestions).

**Test LangSmith:** `cd middleware-platform && npm run test:langsmith`

---

## Cross-Cutting Concerns

### Multi-Region Failover
- **DR plan:** Active-passive or active-active? Document in `docs/runbooks/README.md#dr`
- **Geo-replicated DB** with read replicas
- **DNS failover** (Azure Traffic Manager)
- **RTO/RPO targets** (e.g. RTO: 1 hour, RPO: 5 min)

### Distributed Tracing
- **Propagate trace ID** from Retell webhook (`x-request-id`) through all external calls (Stedi, FHIR, Tiba)
- **OpenTelemetry or Application Insights** for span visualization
- **Trace path:** Retell → middleware → Stedi → Tiba → FHIR

### API Key Rotation
- **Automated rotation:** Stedi/Groq keys every 90 days
- **Zero-downtime:** Support 2 active keys during transition
- **Alert** before expiration

### HIPAA Audit Logging (`hipaa_access_log`)
| Event | Log Fields |
|-------|------------|
| PHI accessed | `user_id`, `patient_id`, `resource_type`, `action`, `ip_address`, `timestamp` |
| PHI modified | Same + `changes` (old/new) |
| PHI exported | Same + `export_format`, `destination` |
| Authentication | `user_id`, `success`, `ip_address`, `timestamp` |
**Retention:** 7 years (HIPAA).

### Database Query Optimization
- Enable Postgres slow query log (queries >1s)
- Indexes: `voice_call_log(clinic_id, created_at)`, `coding_decisions(call_id, created_at)`, `llm_usage_log(call_id, operation)`
- Monitor in Application Insights

### Cost Optimization
- Audit DB for unused tables/columns
- Archive or drop data beyond retention
- Right-size Azure resources (CPU, memory)

---

## Implementation Sequencing

### Week 1: Foundation (P0)

| Day | Task | Deliverable |
|-----|------|-------------|
| Mon | LangChain + LangSmith mandatory | All LLM calls traced |
| Tue | Mandatory code validation | No hallucinated codes |
| Wed | Confidence thresholds | Low-confidence rejected |
| Thu | Postgres retry queue | Syncs never lost |
| Fri | Idempotency for claims | No double-billing |

### Week 2: Resilience (P1)

| Day | Task | Deliverable |
|-----|------|-------------|
| Mon | Circuit breakers | Stedi/Groq/FHIR isolated |
| Tue | Application Insights + correlation ID | Full request tracing |
| Wed | PII redaction | PHI redacted before storage |
| Thu | Rate limiting | Cost spikes prevented |
| Fri | Enhanced health checks | Dependency status visible |

### Week 3: LangGraph Migration (P0)

| Day | Task | Deliverable |
|-----|------|-------------|
| Mon | LangGraph implementation | `coding-graph.js` + dual-write |
| Tue | Shadow mode | Output comparison |
| Wed | 10% canary | Error monitoring |
| Thu | 50% ramp | Latency validation |
| Fri | 100% cutover | Old state service deprecated |

### Week 4: Monitoring & Alerts (P1–P2)

| Day | Task | Deliverable |
|-----|------|-------------|
| Mon | Latency budgets + P95/P99 | SLAs enforced |
| Tue | Alert rules + runbooks | Alerts → runbooks |
| Wed | Token budget enforcement | Limits enforced |
| Thu | Backup & DR testing | Restore verified |
| Fri | Load testing | Capacity baseline |

---

## Acceptance Criteria (Per Task)

Every task should have:

| Criteria | Details |
|----------|---------|
| **Definition of Done** | What "complete" means |
| **Test Cases** | How to verify it works |
| **Rollback Plan** | How to undo if broken |
| **Metrics** | How to measure success |

**Example — Circuit Breaker:**
| Criteria | Details |
|----------|---------|
| Done | Circuit trips after 5 failures in 60s; fallback returns simulated data; auto-closes after 30s |
| Test | 1) Simulate 5 Stedi failures → circuit opens. 2) Wait 30s → half-open. 3) Success → closes |
| Rollback | `circuit_breaker_enabled=false` feature flag |
| Metrics | `circuit_breaker_trips`, `circuit_breaker_state`, `fallback_invocations` |

---

## Gap Analysis — Previously Missing (Now Addressed)

| Category | Added Details |
|----------|---------------|
| **State sync** | 26.1 Dual-write, reconciliation, migration script, rollback, checkpointer |
| **LangSmith** | 25.1 Project naming, tags, retention, PHI controls, cost |
| **Circuit breakers** | 2.1 Thresholds, fallback behavior, metrics, code example |
| **Retry queue** | 2.2 Priority, backoff, DLQ, worker, schema |
| **PII redaction** | 12.1 International IDs, names, MRN, redaction log |
| **Token budget** | 10.1 Per-call tracking, graceful degradation, abuse alert |
| **Health checks** | 19.1 Timeouts, caching, parallel, partial degradation |
| **Feature flags** | 15.1 Gradual rollout, clinic-specific, remote toggle |
| **Idempotency** | 22.1 TTL, cleanup job, index |
| **Alerting** | 20.1 Runbook mapping, template |
| **Load testing** | 23.1 Scenarios, acceptance criteria |
| **Cross-cutting** | Multi-region, distributed tracing, API rotation, HIPAA details, DB optimization |
| **Sequencing** | Week 1–4 rollout plan |
| **Acceptance criteria** | Definition of done, test cases, rollback, metrics per task |


---

<a id="multi-tenant-multi-tenant-voice-agent"></a>

## Multi-Tenant Voice Agent Architecture

*Former path: `docs/architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md`*

## Current Setup (Single Tenant)

```
Patient Calls → Twilio → /voice/incoming → Retell Agent → WebSocket → Backend
```

**Current Flow:**
1. Patient calls Twilio number
2. Twilio sends webhook to `/voice/incoming`
3. Backend registers call with Retell using ONE agent ID
4. Retell connects via WebSocket
5. All calls use same agent, same merchant_id

---

## Multi-Tenant Architecture

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Clinic A (doclittle.site/clinicA)                     │
│  - Twilio Number: +1-555-0100                           │
│  - Retell Agent: agent_clinicA                         │
│  - Merchant ID: clinicA-merchant-id                    │
└─────────────────────────────────────────────────────────┘
                        │
                        │ Call comes in
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Twilio Webhook                                         │
│  /voice/incoming                                         │
│  - Receives: To number (+1-555-0100)                    │
│  - Looks up: Which clinic owns this number?             │
│  - Identifies: Clinic A                                 │
└─────────────────────────────────────────────────────────┘
                        │
                        │ Route to correct tenant
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Backend Processing                                     │
│  - Uses Clinic A's Retell Agent ID                      │
│  - Uses Clinic A's Merchant ID                          │
│  - Stores data in Clinic A's namespace                  │
└─────────────────────────────────────────────────────────┘
                        │
                        │ WebSocket connection
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Retell Agent (Clinic A)                                │
│  - Has Clinic A's custom prompt                         │
│  - Uses Clinic A's functions                            │
│  - Returns Clinic A's data                              │
└─────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Multi-Tenant Setup

### Step 1: Phone Number to Tenant Mapping

**Problem:** When a call comes in, how do we know which clinic it's for?

**Solution:** Map Twilio phone numbers to clinics

```
Database Table: clinic_phone_numbers
┌─────────────┬──────────────┬──────────────┬─────────────┐
│ phone_number│ clinic_id    │ clinic_name  │ tenant_slug │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ +15550100   │ clinic-001   │ Clinic A     │ clinicA     │
│ +15550101   │ clinic-002   │ Clinic B     │ clinicB     │
│ +15550102   │ clinic-003   │ Clinic C     │ clinicC     │
└─────────────┴──────────────┴──────────────┴─────────────┘
```

**Flow:**
1. Call comes to `+1-555-0100`
2. Backend queries: "Which clinic owns +1-555-0100?"
3. Result: "Clinic A"
4. Backend uses Clinic A's configuration

---

### Step 2: Retell Agent Per Clinic

**Option A: One Agent Per Clinic (Recommended)**
- Each clinic has their own Retell agent
- Clinic A: `agent_clinicA_123`
- Clinic B: `agent_clinicB_456`
- Clinic C: `agent_clinicC_789`

**Option B: One Agent with Dynamic Variables**
- Single Retell agent for all clinics
- Pass `clinic_id` as dynamic variable
- Agent uses clinic_id to customize behavior

**Recommendation:** Option A (separate agents) for:
- Better isolation
- Custom prompts per clinic
- Easier troubleshooting
- Independent agent updates

---

### Step 3: Tenant Identification in Webhook

**Current Code:**
```javascript
app.post('/voice/incoming', async (req, res) => {
  const toNumber = req.body.To;  // Twilio number called
  const fromNumber = req.body.From;  // Patient's number
  
  // Currently uses single agent:
  const agentId = process.env.RETELL_AGENT_ID;
  
  // Currently uses single merchant:
  const merchantId = process.env.MERCHANT_ID;
})
```

**Multi-Tenant Code (Conceptual):**
```javascript
app.post('/voice/incoming', async (req, res) => {
  const toNumber = req.body.To;  // +1-555-0100
  const fromNumber = req.body.From;  // Patient's number
  
  // STEP 1: Identify tenant from phone number
  const clinic = db.getClinicByPhoneNumber(toNumber);
  // Returns: { clinic_id: 'clinic-001', name: 'Clinic A', ... }
  
  // STEP 2: Get clinic-specific Retell agent
  const agentId = clinic.retell_agent_id;  // agent_clinicA_123
  
  // STEP 3: Get clinic-specific merchant ID
  const merchantId = clinic.merchant_id;  // clinicA-merchant-id
  
  // STEP 4: Register with Retell using clinic's agent
  const registerPayload = {
    agent_id: agentId,  // Clinic A's agent
    metadata: {
      clinic_id: clinic.clinic_id,
      clinic_name: clinic.name,
      merchant_id: merchantId
    }
  };
})
```

---

### Step 4: Data Isolation

**Problem:** How do we ensure Clinic A's data doesn't mix with Clinic B's?

**Solution:** Tenant-scoped database queries

**Current:**
```javascript
// Gets ALL patients
const patients = db.getAllPatients();
```

**Multi-Tenant:**
```javascript
// Gets ONLY Clinic A's patients
const patients = db.getPatientsByClinic(clinicId);
```

**Database Schema:**
```
fhir_patients table:
┌─────────────┬──────────────┬─────────────┐
│ patient_id  │ clinic_id    │ name        │
├─────────────┼──────────────┼─────────────┤
│ patient-001 │ clinic-001   │ John Doe    │
│ patient-002 │ clinic-001   │ Jane Smith  │
│ patient-003 │ clinic-002   │ Bob Jones   │
└─────────────┴──────────────┴─────────────┘
```

**All tables need `clinic_id`:**
- `fhir_patients` → `clinic_id`
- `appointments` → `clinic_id`
- `insurance_claims` → `clinic_id`
- `eligibility_checks` → `clinic_id`
- `users` → `clinic_id`

---

### Step 5: Retell WebSocket Handler

**Current:** Single handler for all calls

**Multi-Tenant:** Handler needs clinic context

**Flow:**
1. WebSocket connects with `call_id`
2. Look up call in database to get `clinic_id`
3. Use `clinic_id` for all function calls
4. All data operations scoped to that clinic

**Example:**
```javascript
// When Retell calls schedule_appointment function
async handleScheduleAppointment(callId, args) {
  // STEP 1: Get clinic from call
  const call = db.getCall(callId);
  const clinicId = call.clinic_id;
  
  // STEP 2: All operations scoped to clinic
  const appointment = await BookingService.scheduleAppointment({
    ...args,
    clinic_id: clinicId  // Ensures appointment belongs to Clinic A
  });
  
  // STEP 3: Check Clinic A's calendar (not Clinic B's)
  const calendar = BookingService.getCalendarClient(clinicId);
}
```

---

### Step 5.1: Clinic Context Enforcement

- All `/voice/appointments/*` endpoints now require `clinic_id` in the payload or `x-clinic-id` header.
- The Retell WebSocket handler injects the caller’s clinic into every HTTP call (schedule, confirm, cancel, reschedule, search, available slots).
- `BookingService` validates that `clinic_id` is present for schedule/search requests and refuses to operate if the appointment belongs to another clinic.
- `database.js` filters every appointment query/update by `clinic_id`, so cross-tenant lookups return zero rows.
- `tests/test-tenant-isolation.js` creates appointments for two clinics with identical patient metadata to ensure one clinic can’t read the other’s records.

---

### Step 6: Retell Agent Configuration

**Per-Clinic Retell Agents:**

**Clinic A Agent:**
- Agent ID: `agent_clinicA_123`
- Prompt: "You are Kelly, the receptionist for Clinic A..."
- Functions: Same functions, but backend routes to Clinic A
- Webhook URL: `https://doclittle.site/voice/incoming` (same for all)

**Clinic B Agent:**
- Agent ID: `agent_clinicB_456`
- Prompt: "You are Kelly, the receptionist for Clinic B..."
- Functions: Same functions, but backend routes to Clinic B
- Webhook URL: `https://doclittle.site/voice/incoming` (same for all)

**Key Point:** All agents use the SAME webhook URL, but backend identifies tenant from phone number.

---

### Step 7: Twilio Configuration

**Option A: One Twilio Account, Multiple Numbers**
- One Twilio account for DocLittle
- Each clinic gets a phone number
- All numbers point to same webhook: `/voice/incoming`
- Backend identifies tenant from `To` number

**Option B: Multiple Twilio Accounts**
- Each clinic has their own Twilio account
- More isolation, but more complex
- Not recommended unless needed

**Recommendation:** Option A (one account, multiple numbers)

---

## Complete Multi-Tenant Flow

### Example: Patient Calls Clinic A

1. **Patient calls:** `+1-555-0100` (Clinic A's number)

2. **Twilio receives call:**
   - Sends webhook to: `https://doclittle.site/voice/incoming`
   - Includes: `To: +15550100`, `From: +15551234567`

3. **Backend identifies tenant:**
   ```javascript
   const clinic = db.getClinicByPhoneNumber('+15550100');
   // Returns: { clinic_id: 'clinic-001', retell_agent_id: 'agent_clinicA_123', ... }
   ```

4. **Backend registers with Retell:**
   ```javascript
   {
     agent_id: 'agent_clinicA_123',  // Clinic A's agent
     metadata: {
       clinic_id: 'clinic-001',
       merchant_id: 'clinicA-merchant-id'
     }
   }
   ```

5. **Retell connects via WebSocket:**
   - Uses Clinic A's agent
   - Calls functions with clinic context

6. **Function calls are clinic-scoped:**
   ```javascript
   schedule_appointment() {
     // Automatically uses Clinic A's calendar
     // Stores appointment with clinic_id: 'clinic-001'
     // Checks Clinic A's availability
   }
   ```

7. **Data is isolated:**
   - Patient records: `clinic_id: 'clinic-001'`
   - Appointments: `clinic_id: 'clinic-001'`
   - Calendar: Clinic A's Google Calendar

---

## Database Schema Changes Needed

### New Tables

**1. `clinics` table:**
```sql
CREATE TABLE clinics (
  clinic_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,  -- 'clinicA', 'clinicB'
  retell_agent_id TEXT,
  merchant_id TEXT,
  google_calendar_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**2. `clinic_phone_numbers` table:**
```sql
CREATE TABLE clinic_phone_numbers (
  phone_number TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id)
);
```

### Existing Tables - Add `clinic_id`

**All existing tables need `clinic_id` column:**
- `fhir_patients` → `clinic_id`
- `appointments` → `clinic_id`
- `insurance_claims` → `clinic_id`
- `eligibility_checks` → `clinic_id`
- `users` → `clinic_id`

---

## Retell Configuration Per Clinic

### Setting Up Agents

**For each clinic:**
1. Create Retell agent in Retell dashboard
2. Configure agent with clinic-specific prompt
3. Set webhook URL: `https://doclittle.site/voice/incoming` (same for all)
4. Store agent ID in `clinics.retell_agent_id`

**Agent Prompt Example (Clinic A):**
```
You are Kelly, the receptionist for Clinic A, a mental health practice...
Our clinic specializes in...
Our hours are...
```

**Agent Prompt Example (Clinic B):**
```
You are Kelly, the receptionist for Clinic B, a pediatric clinic...
Our clinic specializes in...
Our hours are...
```

---

## Summary: What Needs to Change

### 1. Database
- ✅ Add `clinics` table
- ✅ Add `clinic_phone_numbers` table
- ✅ Add `clinic_id` to all existing tables

### 2. Webhook Handler (`/voice/incoming`)
- ✅ Look up clinic from phone number
- ✅ Use clinic's Retell agent ID
- ✅ Use clinic's merchant ID
- ✅ Pass clinic_id in metadata

### 3. Retell WebSocket Handler
- ✅ Get clinic_id from call metadata
- ✅ Scope all function calls to clinic
- ✅ Use clinic's calendar, data, etc.

### 4. All Service Functions
- ✅ Accept `clinic_id` parameter
- ✅ Filter queries by `clinic_id`
- ✅ Store data with `clinic_id`

### 5. Retell Dashboard
- ✅ Create one agent per clinic
- ✅ Configure clinic-specific prompts
- ✅ Store agent IDs in database

---

## Key Principles

1. **Phone Number = Tenant Identifier**
   - When call comes in, phone number tells us which clinic

2. **One Agent Per Clinic**
   - Each clinic has their own Retell agent
   - Allows custom prompts and behavior

3. **Data Isolation**
   - Every database query filtered by `clinic_id`
   - No cross-clinic data access

4. **Shared Infrastructure**
   - Same webhook URL for all clinics
   - Same backend code
   - Same database (with tenant isolation)

5. **Scalable**
   - Add new clinic = Add phone number + Create Retell agent
   - No code changes needed

---

## Next Steps (When Ready to Code)

1. Create database migration for `clinics` and `clinic_phone_numbers` tables
2. Add `clinic_id` columns to existing tables
3. Update `/voice/incoming` to identify tenant
4. Update Retell WebSocket handler to use clinic context
5. Update all service functions to accept `clinic_id`
6. Create Retell agents for each clinic
7. Test with multiple clinics

---

## Questions to Answer Before Coding

1. **How many clinics initially?** (affects migration strategy)
2. **Do clinics share phone numbers or separate?** (affects Twilio setup)
3. **Do clinics have different business hours?** (affects booking service)
4. **Do clinics have different appointment types?** (affects booking service)
5. **Do clinics share insurance providers?** (affects insurance service)
6. **How do we create new clinics?** (admin interface needed?)



---

<a id="multi-tenant-multi-tenant-signup-implementation"></a>

## Multi-Tenant Clinic Signup Implementation

*Former path: `docs/architecture/multi-tenant/multi-tenant-signup-implementation.md`*

## Overview

This document describes the implementation of the automated multi-tenant clinic signup flow, including Retell agent creation and database setup.

## What Was Implemented

### 1. Database Schema

#### New Tables

**`clinics` table:**
- `id` (TEXT PRIMARY KEY) - Unique clinic ID
- `clinic_slug` (TEXT UNIQUE) - URL-friendly clinic identifier (e.g., "acme-medical-center")
- `name` (TEXT) - Clinic name
- `phone_number` (TEXT) - Clinic phone number
- `retell_agent_id` (TEXT) - Retell AI agent ID
- `retell_agent_status` (TEXT) - Status: 'pending' or 'active'
- `merchant_id` (TEXT UNIQUE) - Payment merchant ID
- `business_hours` (TEXT) - Business hours
- `timezone` (TEXT) - Timezone (default: 'America/New_York')
- `address` (TEXT) - Clinic address
- `description` (TEXT) - Clinic description
- `status` (TEXT) - Status: 'active' or 'inactive'
- `created_at` (DATETIME) - Creation timestamp
- `updated_at` (DATETIME) - Last update timestamp

**`clinic_phone_numbers` table:**
- `id` (TEXT PRIMARY KEY) - Unique phone record ID
- `clinic_id` (TEXT) - Foreign key to clinics.id
- `phone_number` (TEXT) - Phone number (E.164 format)
- `twilio_phone_sid` (TEXT) - Twilio phone SID (for future use)
- `status` (TEXT) - Status: 'active' or 'inactive'
- `created_at` (DATETIME) - Creation timestamp

#### Database Functions

Added to `database.js`:
- `createClinic(clinic)` - Create a new clinic
- `getClinicById(id)` - Get clinic by ID
- `getClinicBySlug(slug)` - Get clinic by slug
- `getClinicByPhoneNumber(phoneNumber)` - Get clinic by phone number
- `updateClinic(id, updates)` - Update clinic information
- `createClinicPhoneNumber(phoneData)` - Link phone number to clinic
- `getClinicPhoneNumber(phoneNumber)` - Get clinic by phone number
- `getClinicPhoneNumbers(clinicId)` - Get all phone numbers for a clinic

### 2. Retell API Service

**File:** `middleware-platform/services/retell-service.js`

**Features:**
- Automated Retell agent creation via API
- Clinic-specific prompt generation from template
- Function loading (schedule_appointment, collect_insurance, get_patient_claims, process_payment)
- Agent update and retrieval methods
- Mock mode fallback if API key is not configured

**Methods:**
- `createAgent(clinicData)` - Create a new Retell agent
- `updateAgent(agentId, updates)` - Update an existing agent
- `getAgent(agentId)` - Get agent details
- `generateClinicPrompt(clinicData)` - Generate clinic-specific prompt
- `loadRetellFunctions()` - Load function definitions

### 3. Signup Form Updates

**File:** `unified-dashboard/login.html`

**Changes:**
- Added "Clinic Name" field
- Added "Clinic Phone Number" field (E.164 format)
- Added validation for phone number format
- Updated signup handler to send clinic information
- Updated redirect logic to use clinic slug (for production)

### 4. Signup Endpoint

**File:** `middleware-platform/server.js`

**Endpoint:** `POST /api/auth/signup`

**Process:**
1. **Validation:**
   - Validate user name, email, password
   - Validate clinic name and phone number
   - Check phone number format (E.164)
   - Check if user email already exists
   - Check if clinic name/slug already exists
   - Check if phone number is already in use

2. **Clinic Creation:**
   - Generate clinic slug from clinic name
   - Ensure slug is unique (append number if needed)
   - Create clinic record in database
   - Generate unique merchant ID

3. **Retell Agent Creation:**
   - Create Retell agent via API
   - Generate clinic-specific prompt
   - Store agent ID in clinic record
   - Handle errors gracefully (continue even if agent creation fails)

4. **Phone Number Linking:**
   - Link phone number to clinic in `clinic_phone_numbers` table
   - Store Twilio phone SID (for future use)

5. **User Creation:**
   - Hash password
   - Create user record with `clinic_id`
   - Link user to clinic and merchant

6. **Response:**
   - Return user session data
   - Return clinic information (ID, slug, agent ID)
   - Return `clinic_slug` for redirect

### 5. Test Script

**File:** `middleware-platform/tests/test-clinic-signup.js`

**Tests:**
- Signup API call
- Clinic record creation
- User record creation with clinic_id
- Phone number linkage
- Clinic slug uniqueness
- Database consistency

**Run:**
```bash
node tests/test-clinic-signup.js
```

## Configuration

### Environment Variables

Required in `.env`:
- `RETELL_API_KEY` - Retell AI API key (optional, will use mock mode if not set)
- `RETELL_API_BASE_URL` - Retell API base URL (default: 'https://api.retellai.com')
- `RETELL_LLM_WEBSOCKET_URL` - WebSocket URL for Retell LLM (default: 'wss://doclittle.site/retell-llm')

### Retell API Endpoints

- Create Agent: `POST /v2/create-agent`
- Update Agent: `PATCH /v2/update-agent/{agent_id}`
- Get Agent: `GET /v2/get-agent/{agent_id}`

## Usage

### Signup Flow

1. User fills out signup form:
   - Full Name
   - Clinic Name
   - Clinic Phone Number
   - Email Address
   - Password
   - Confirm Password

2. Backend processes signup:
   - Creates clinic record
   - Creates Retell agent (or marks as pending)
   - Links phone number to clinic
   - Creates user account
   - Returns clinic slug

3. Frontend redirects:
   - Production: `doclittle.site/{clinic_slug}/dashboard.html`
   - Development: `business/business-dashboard.html`

### Clinic Slug Generation

- Converts clinic name to lowercase
- Replaces non-alphanumeric characters with hyphens
- Removes leading/trailing hyphens
- Limits to 50 characters
- Ensures uniqueness (appends number if needed)

Example:
- "Acme Medical Center" → "acme-medical-center"
- "Acme Medical Center" (if exists) → "acme-medical-center-1"

## Future Enhancements

### 1. URL Routing

Set up server-side routing for clinic-specific URLs:
- `doclittle.site/{clinic_slug}` → Load clinic dashboard
- `doclittle.site/{clinic_slug}/settings` → Clinic settings
- `doclittle.site/{clinic_slug}/patients` → Patient management

### 2. Twilio Phone Number Integration

- Automatically purchase Twilio phone numbers for clinics
- Link Twilio phone SID to clinic
- Configure Twilio webhooks for clinic-specific routing

### 3. Clinic Settings

- Allow clinics to customize their Retell agent prompt
- Allow clinics to update business hours
- Allow clinics to manage multiple phone numbers

### 4. Multi-User Clinic Support

- Allow multiple users to belong to the same clinic
- Role-based access control (admin, provider, staff)
- Clinic-specific permissions

### 5. Data Isolation

- Add `clinic_id` to all existing tables (patients, appointments, claims, etc.)
- Filter all queries by `clinic_id`
- Ensure data isolation between clinics

## Testing

### Manual Testing

1. Start the backend server:
   ```bash
   cd middleware-platform
   node server.js
   ```

2. Open the signup form:
   ```
   http://localhost:8000/login.html
   ```

3. Fill out the form and submit

4. Verify:
   - Clinic record is created in database
   - Retell agent is created (or marked as pending)
   - Phone number is linked to clinic
   - User is created with clinic_id
   - Redirect works correctly

### Automated Testing

Run the test script:
```bash
node tests/test-clinic-signup.js
```

## Error Handling

### Retell Agent Creation Failure

- Clinic is still created
- `retell_agent_status` is set to 'pending'
- Admin can manually create agent later
- Error is logged for debugging

### Phone Number Already in Use

- Returns 400 error
- User must use a different phone number
- Prevents duplicate clinics with same phone

### Clinic Slug Collision

- Automatically appends number to slug
- Ensures unique slug for each clinic
- No user intervention required

## Database Migrations

### Existing Tables

The following tables already have `clinic_id` column (added via migration):
- `users` - Users belong to a clinic
- `fhir_patients` - Patients belong to a clinic
- `eligibility_checks` - Eligibility checks belong to a clinic
- `insurance_claims` - Claims belong to a clinic

### Future Migrations

Add `clinic_id` to:
- `appointments` - Appointments belong to a clinic
- `voice_checkouts` - Checkouts belong to a clinic
- `transactions` - Transactions belong to a clinic
- Other tables as needed

## Security Considerations

1. **Phone Number Validation:**
   - Validates E.164 format
   - Prevents duplicate phone numbers
   - Ensures phone numbers are unique per clinic

2. **Clinic Slug Validation:**
   - Generates URL-safe slugs
   - Prevents SQL injection
   - Ensures uniqueness

3. **User Isolation:**
   - Users are linked to clinics via `clinic_id`
   - Queries should filter by `clinic_id`
   - Prevents cross-clinic data access

## Next Steps

1. **Test the signup flow:**
   - Run the test script
   - Test manually via the signup form
   - Verify Retell agent creation (if API key is set)

2. **Set up URL routing:**
   - Configure Netlify redirects for clinic URLs
   - Or set up server-side routing
   - Update frontend to handle clinic-specific routes

3. **Add clinic_id to remaining tables:**
   - Migrate existing data
   - Update queries to filter by clinic_id
   - Test data isolation

4. **Integrate Twilio:**
   - Purchase phone numbers for clinics
   - Configure Twilio webhooks
   - Link phone numbers to Retell agents

5. **Update Retell WebSocket handler:**
   - Look up clinic by phone number
   - Use clinic-specific configuration
   - Filter data by clinic_id

## Summary

✅ Database schema created
✅ Retell API service implemented
✅ Signup form updated
✅ Signup endpoint implemented
✅ Test script created
✅ Error handling implemented
✅ Documentation created

The multi-tenant clinic signup flow is now fully functional and ready for testing!



---

<a id="overview-architecture-overview-and-colab-rag"></a>

## DocLittle Platform: Architecture Overview & Colab RAG Integration

*Former path: `docs/architecture/overview/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`*

**Document Purpose**: Single reference for (1) connecting Colab RAG, (2) billing/medical coding agent architecture, (3) medical reasoning flow, (4) voice agent integration, and (5) payment for appointments.

---

## 1. Connecting Your Colab RAG

### 1.1 Architecture Overview

```
┌─────────────────────┐     POST /retrieve      ┌─────────────────────┐
│  Colab RAG          │ ◄────────────────────── │  middleware         │
│  (Pinecone-backed) │                         │  remote-rag-client   │
│  localhost:5000     │     POST /health        │  (knowledge-service) │
│  or Render URL      │ ◄────────────────────── │                     │
└─────────────────────┘                         └─────────────────────┘
        ▲                                              │
        │ COLAB_RAG_URL                                │ RAG_API_URL
        │ (proxy target)                               │ (caller target)
        └─────────────────────────────────────────────┘
                     rag-proxy routes /api/rag/*
```

### 1.2 Two Connection Modes

#### Option A: Via Middleware Proxy (Recommended for local Colab)

When Colab runs on `localhost:5000` (or another local port), the middleware proxies requests so a single ngrok tunnel can reach both API and RAG.

1. **Start your Colab RAG** so it serves:
   - `POST /retrieve` or `POST /api/retrieve`
   - `GET /health`

2. **Set environment variables** (in `.env` or shell):

   ```env
   # Where the Colab RAG actually runs (proxy target)
   COLAB_RAG_URL=http://localhost:5000
   # Or if using a port:
   COLAB_RAG_PORT=5000

   # Where knowledge-service calls RAG (defaults to middleware proxy)
   RAG_API_URL=http://localhost:4000/api/rag
   ```

   When `RAG_API_URL=http://localhost:4000/api/rag`, the middleware:
   - Receives requests at `/api/rag/retrieve` and `/api/rag/health`
   - Forwards them to `COLAB_RAG_URL` (or `http://localhost:${COLAB_RAG_PORT}`)

#### Option B: Direct to Colab (Render / ngrok to Colab)

When Colab is publicly reachable (e.g., Render, ngrok to Colab):

```env
# Point directly at your Colab RAG
RAG_API_URL=https://your-colab-rag.onrender.com
# or
RAG_API_URL=https://xxxx.ngrok.io
```

In this case, `COLAB_RAG_URL` is only used by the rag-proxy for external clients; the knowledge-service talks directly to `RAG_API_URL`.

### 1.3 Colab RAG API Contract

Your Colab RAG must implement:

#### POST `/retrieve` (or `/api/retrieve`)

**Request body**:
```json
{
  "query": "patient reports chest pain and shortness of breath",
  "specialty": "general",
  "region": "US",
  "exclusion_terms": ["ruled out"],
  "top_k": 20
}
```

**Response body** (required shape):
```json
{
  "icd10": [
    { "code": "R07.9", "description": "Chest pain, unspecified", "score": 0.92 }
  ],
  "cpt": [
    { "code": "99213", "description": "Office visit, level 3", "score": 0.85 }
  ],
  "hcpcs": []
}
```

- `score` or `confidence` (0–1) is used for ranking; default 0.8 if missing.
- Empty arrays are fine; the platform falls back to local search when remote returns nothing.

#### GET `/health`

Return a JSON object (e.g., `{"status":"ok"}`) for health checks.

### 1.4 Files Involved

| File | Role |
|------|------|
| `middleware-platform/routes/rag-proxy.js` | Proxies `/api/rag/retrieve`, `/api/rag/retrieve_passages`, and `/api/rag/health` to `COLAB_RAG_URL` |
| `middleware-platform/services/layer2-rag/remote-rag-client.js` | Calls Colab RAG via `retrieveFromColabRAG()` |
| `middleware-platform/services/layer2-rag/patient-education-client.js` | Patient education passages via `retrievePatientEducationPassages()` / `retrievePatientEducationForDermQA()` |
| `middleware-platform/services/knowledge-service.js` | Uses Colab RAG in `getCandidatesForCoding()` and `getCodeCandidatesDualSource()` |

### 1.5 Verification

```bash
# Test health (via proxy)
curl http://localhost:4000/api/rag/health

# Test retrieve (via proxy)
curl -X POST http://localhost:4000/api/rag/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"chest pain","specialty":"general","top_k":10}'
```

### 1.6 Patient education passages (derm Q&A) — `RAG_EDUCATION_URL` vs `RAG_API_URL`

The **code RAG** path (`POST /retrieve`) returns ICD/CPT/HCPCS candidates. **Patient education** uses a **parallel** index and contract: **`POST /retrieve_passages`**.

| Variable | Purpose |
|----------|---------|
| **`RAG_API_URL`** | Base URL used by `remote-rag-client.js` for **`/retrieve`** (codes). Default when using the middleware proxy: `http://localhost:4000/api/rag`. |
| **`RAG_EDUCATION_URL`** | Optional **separate** base URL for **`/retrieve_passages`** (text chunks). If **unset**, `patient-education-client.js` falls back to the same base as `RAG_API_URL` and calls **`/retrieve_passages`** on that host (e.g. `http://localhost:4000/api/rag/retrieve_passages` via the proxy). |

Use a **dedicated** `RAG_EDUCATION_URL` when the education index is deployed separately from the code index (different Colab, Render service, or Pinecone namespace).

```env
# Same tunnel: proxy forwards both /retrieve and /retrieve_passages to Colab
RAG_API_URL=http://localhost:4000/api/rag
# RAG_EDUCATION_URL unset → client uses RAG_API_URL + /retrieve_passages

# Split backends
RAG_API_URL=http://localhost:4000/api/rag
RAG_EDUCATION_URL=https://your-education-rag.example.com
```

Full contract, corpus versioning, and middleware behavior: [`derm-patient-qa/PHASE_3_CORPUS_AND_INDEX.md`](derm-patient-qa/PHASE_3_CORPUS_AND_INDEX.md).

Implementation:

| File | Role |
|------|------|
| `middleware-platform/services/layer2-rag/patient-education-client.js` | Calls **`/retrieve_passages`**, respects Phase 2 triage `retrieval_policy` |
| `middleware-platform/services/layer2-rag/patient-education-query.js` | Lay ↔ clinical expansion + optional HyDE |
| `middleware-platform/services/layer2-rag/patient-education-passage-rerank.js` | Lexical rerank on passages |
| `middleware-platform/routes/rag-proxy.js` | Proxies **`/api/rag/retrieve_passages`** to Colab |

---

## 2. Billing / Medical Coding Agent Architecture

### 2.1 State Machine (LangGraph-Style)

The medical coding agent follows a strict stage flow:

```
INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING
```

| Stage | Description |
|-------|-------------|
| **INTAKE** | Call start; collecting patient info, scheduling |
| **EXTRACTION** | Patient described symptoms; extracting entities from speech |
| **TRIAGE** | Assessing urgency: EMERGENT / URGENT / ROUTINE |
| **CODING** | Searching ICD-10, CPT, HCPCS via RAG + local knowledge |
| **VALIDATION** | Validating code pairs, checking guidelines |
| **BILLING** | Insurance, pricing, checkout |

Transitions only advance forward (or to BILLING); no backwards transitions.

### 2.2 Persistence & Tables

| Table | Purpose |
|-------|---------|
| `voice_call_states` | Current stage and `state_data` per call |
| `voice_conversation_memory` | Turn-by-turn transcript (role, content) |
| `agent_state_snapshots` | Stage transition snapshots for audit |
| `coding_decisions` | ICD/CPT pairs proposed and validated |
| `function_call_log` | Tool calls, response times, success/failure |

### 2.3 Implemented Components

| Component | Location | Status |
|-----------|----------|--------|
| State flow service | `coding-state-service.js` | ✅ |
| Context assembler | `context-assembler-service.js` | ✅ |
| RAG pipeline | `knowledge-service.js`, `getCodeCandidates()` | ✅ |
| Red-flag detection | `triage-service.js` | ✅ |
| Code search (ICD-10, CPT, HCPCS) | DB + JSON reference | ✅ |
| Code-pair validation | `validateCodePair()`, rules | ✅ |
| Triage rules | `Knowledge/rules/triage-rules.json` | ✅ |
| Medical abbreviations | `Knowledge/ontology/medical-abbreviations.json` | ✅ |
| Phrase expansions | `MEDICAL_PHRASES`, `PHRASE_EXPANSIONS` | ✅ |

---

## 3. Medical Reasoning

### 3.1 RAG Pipeline

1. **Query construction**: Raw text → abbreviation expansion → synonym normalization → keyword/phrase extraction.
2. **Dual-source retrieval**:
   - **Remote (Colab RAG)**: When `RAG_API_URL` is set, `retrieveFromColabRAG()` is called first.
   - **Local**: Keyword search against `icd10_codes`, `cpt_codes`, `hcpcs_codes` (DB) or JSON reference.
3. **Merge & filter**:
   - Negative constraints (e.g., "ruled out X")
   - Guideline filtering (e.g., `filterIcd10ByGuidelines`)
   - Perceptual reranking when `perceptualState` is present
4. **Validation**: `validateCodePair(icd10, cpt)` and `validateCodesExist()` ensure codes exist and pairs are compatible.

### 3.2 Call Paths That Use RAG

| Path | Function | RAG Source |
|------|----------|------------|
| **Voice** | `suggest_codes_from_symptoms` | `getCodeCandidates()` → Colab + local |
| **PDF** | `getCandidatesForCoding()` | Colab (if URL set) + local fallback |
| **Video** | `getCodeCandidatesDualSource()` | Colab + local in parallel, merge |

### 3.3 Safety Layer

- **Triage**: `assess_urgency()` → `detectRedFlags()` (regex on triage-rules.json). EMERGENT blocks scheduling.
- **Pre-schedule check**: `checkBeforeScheduling()` prevents booking for emergency symptoms.
- **Code validation**: Rejects non-existent codes and incompatible ICD/CPT pairs.

---

## 4. Voice Agent Integration

### 4.1 End-to-End Flow

```
Patient calls → Retell (ASR + LLM + TTS) → WebSocket to middleware
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              schedule_appointment    suggest_codes_from_symptoms   create_checkout
                    │                         │                         │
                    ▼                         ▼                         ▼
         /voice/appointments/schedule   knowledgeService.getCodeCandidates  /voice/checkout/create
                    │                         │                         │
                    ▼                         ▼                         ▼
              BookingService          Colab RAG + local merge      Payment flow
```

### 4.2 Voice Agent Tools (Functions)

| Function | Handler | Backend |
|----------|---------|---------|
| `schedule_appointment` | `handleScheduleAppointment` | `POST /voice/appointments/schedule` |
| `get_available_slots` | `handleGetAvailableSlots` | `POST /voice/appointments/available-slots` |
| `search_appointments` | `handleSearchAppointments` | `POST /voice/appointments/search` |
| `confirm_appointment` | `handleConfirmAppointment` | `POST /voice/appointments/confirm` |
| `cancel_appointment` | `handleCancelAppointment` | `POST /voice/appointments/cancel` |
| `reschedule_appointment` | `handleRescheduleAppointment` | `POST /voice/appointments/reschedule` |
| `create_appointment_checkout` | — | `POST /voice/appointments/checkout` |
| `create_checkout` | `handleCreateCheckout` | `POST /voice/checkout/create` |
| `verify_checkout_code` | — | `POST /voice/checkout/verify` |
| `assess_urgency` | `handleAssessUrgency` | `triage-service.detectRedFlags()` |
| `search_icd10_codes` | `handleSearchIcd10Codes` | `knowledge-service.searchIcd10Codes()` |
| `search_cpt_codes` | `handleSearchCptCodes` | `db.searchCptCodes()` |
| `search_hcpcs_codes` | `handleSearchHcpcsCodes` | `knowledge-service.searchHcpcsCodes()` |
| `suggest_codes_from_symptoms` | `handleSuggestCodesFromSymptoms` | `knowledge-service.getCodeCandidates()` (RAG) |
| `validate_code_pair` | `handleValidateCodePair` | `knowledge-service.validateCodePair()` |
| `get_code_pricing` | `handleGetCodePricing` | `fee-schedule-service` |
| `check_payer_guidelines` | `handleCheckPayerGuidelines` | `fee-schedule-service` |

### 4.3 Dynamic Variables (Call Context)

Set when the call is registered; used by tools:

| Variable | Purpose |
|----------|---------|
| `clinic_id` | Tenant, calendar, slots, checkout, credits |
| `merchant_id` | Checkout, products |
| `patient_id` | Patient context (when recognized) |
| `patient_name` | Booking, checkout |
| `has_insurance` | Context for copay/eligibility |

---

## 5. Payment for Appointments

### 5.1 Two Payment Systems

| System | Purpose | Status |
|--------|---------|--------|
| **Circle API** | USDC transfers for insurance claims | ✅ Implemented |
| **Stripe / Link** | Card payments for appointments, products | ✅ Link-based working |

### 5.2 Appointment → Payment Flow

```
1. schedule_appointment (voice) → POST /voice/appointments/schedule
   └─ Creates appointment (pending confirmation)
   
2. create_appointment_checkout → POST /voice/appointments/checkout
   └─ Creates checkout tied to appointment_id
   └─ Amount from: visit_pricing (clinic + appointment_type), or eligibility

3. create_checkout (products) OR link-based flow:
   └─ POST /voice/checkout/create
   └─ Sends verification code to email
   └─ Patient verifies → gets payment link
   
4. Patient pays:
   └─ Stripe (card) or Circle wallet (USDC)
   └─ POST /voice/checkout/complete/:checkout_id
   
5. Appointment auto-confirmed:
   └─ BookingService.confirmAppointment() after successful payment
```

### 5.3 Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /voice/appointments/schedule` | Create appointment (name, phone, email, date, time, clinic) |
| `POST /voice/appointments/checkout` | Create checkout for an appointment (copay) |
| `POST /voice/checkout/create` | Create checkout (product or appointment); sends verification code |
| `POST /voice/checkout/verify` | Verify email code, return payment URL |
| `POST /voice/checkout/complete/:id` | Complete payment (Stripe or wallet) |

### 5.4 Amount Resolution

1. Eligibility/copay (when `patient_id` + `payer_id` available)
2. `visit_pricing` table (clinic + appointment_type)
3. Surge pricing when enabled
4. Fallback default ($69)

### 5.5 Payment Methods

- **Link-based**: Email verification → link → Stripe Checkout
- **Wallet**: USDC via Circle (when patient has wallet)
- **Direct Stripe**: Payment Intent (TODO for voice commerce)

---

## 6. Quick Reference: Connect Colab RAG

1. Implement in Colab:
   - `POST /retrieve` or `POST /api/retrieve` (request/response as above)
   - `GET /health`

2. Configure `.env`:
   ```env
   COLAB_RAG_URL=http://localhost:5000    # Or your Colab URL
   RAG_API_URL=http://localhost:4000/api/rag   # Use proxy
   ```

3. Restart middleware.

4. Test: `curl http://localhost:4000/api/rag/health`

5. Verify logs: `📚 Colab RAG: N ICD-10, M CPT candidates` when codes are suggested during a voice call.

---

## 7. Middleware Platform Orchestration

The **middleware platform** (`middleware-platform/server.js` and services) is the central orchestration layer. It does not run the voice agent (Retell does). Instead, it:

1. **Exposes HTTP/WebSocket endpoints** that Retell calls
2. **Routes tool invocations** to the correct services
3. **Persists state** (FHIR, claims, appointments, checkout) in SQLite/Postgres
4. **Orchestrates cross-cutting flows** (eligibility → claim → EOB → settlement)

### 7.1 Middleware ↔ Voice Agent

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  RETELL (Voice Agent)                                                                     │
│  - ASR, LLM, TTS, tool routing                                                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                    WebSocket (wss://.../retell-llm) + HTTP (Twilio → /voice/incoming)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  MIDDLEWARE PLATFORM                                                                      │
│  ┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────┐   │
│  │ retell-       │  │ server.js       │  │ routes/         │  │ services/             │   │
│  │ websocket.js  │  │ (HTTP routes)  │  │ voice.js,       │  │ knowledge-service,    │   │
│  │               │  │                │  │ rag-proxy,      │  │ triage-service,       │   │
│  │ Tool handlers │  │ /voice/*,      │  │ fhir.js,        │  │ fhir-service,        │   │
│  │ → services    │  │ /api/*         │  │ payment.js,     │  │ booking-service,     │   │
│  └───────────────┘  └─────────────────┘  └─────────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  database.js (SQLite / Postgres)                                                          │
│  fhir_patients, fhir_encounters, appointments, insurance_claims, eligibility_checks,       │
│  voice_call_states, voice_conversation_memory, voice_checkouts                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Middleware ↔ Billing Mechanisms

| Billing Flow | Middleware Role | Services Involved |
|--------------|-----------------|-------------------|
| **Patient copay** | Creates checkout, verifies email, completes payment | `server.js` routes, PaymentOrchestrator, Stripe/Circle |
| **Insurance claim** | Submits X12 837, checks status, stores claim | InsuranceService, Stedi API |
| **EOB / pre-adjudication** | Calculates patient responsibility from eligibility + fee schedule | EOBCalculationService, FeeScheduleService |
| **Settlement** | Decides full/partial/hold from coding confidence | SettlementService, EscrowOrchestratorService |
| **Invoice** | Creates invoice from claim | InvoiceService |

Middleware **does not** hold insurance credentials or payment cards; it orchestrates API calls (Stedi, Stripe, Circle) and persists results.

---

## 8. Billing Agent Main Functionality

The “billing agent” is the set of voice tools and backend services that handle medical coding, pricing, eligibility, claims, and settlement. It is **not** a separate agent; it is embedded in the voice agent via tools.

### 8.1 Core Functions

| Function | Purpose |
|----------|---------|
| **assess_urgency** | Triage before scheduling or coding; blocks scheduling for emergencies |
| **search_icd10_codes / search_cpt_codes / search_hcpcs_codes** | Look up codes by keyword during the call |
| **suggest_codes_from_symptoms** | One-shot: patient describes symptoms → ICD-10 + CPT candidates (RAG + local) |
| **validate_code_pair** | Ensure ICD-10 + CPT are compatible and exist; logs to `coding_decisions` |
| **check_payer_guidelines** | Check if payer has fee schedule in DB |
| **get_code_pricing** | Return allowed amounts for CPT codes from `fee_schedules` |
| **collect_insurance** | Collect member_id, payer; run eligibility; store in `patient_insurance` |
| **create_appointment_checkout** | Create checkout for appointment copay |

### 8.2 Claim Lifecycle (Insurance Billing)

```
1. ELIGIBILITY
   Voice: collect_insurance → POST /voice/insurance/collect
   → PayerCacheService.validatePatientInsurance
   → InsuranceService.checkEligibility (Stedi 270/271)
   → db.createEligibilityCheck
   → Return: { eligible, copay, allowed_amount, insurance_pays, deductible_total, ... }

2. CLAIM SUBMISSION
   API: POST /voice/insurance/submit-claim
   → InsuranceService.submitClaim (Stedi 837)
   → db.createInsuranceClaim
   → Optional: FHIRService.createCardForBill/copay if patient owes

3. PRE-ADJUDICATION (real-time)
   API: GET /api/claims/:claimId/pre-adjudicate
   → AdjudicationService.runAdjudication
   → EOBCalculationService.calculateEOBFromClaim (uses fee schedule when payer + CPT present)
   → SettlementService.getSettlementDecision (coding confidence → full/partial/hold)

4. CLAIM STATUS
   Voice/API: check_claim_status → InsuranceService.checkClaimStatus (Stedi 276/277)

5. POST-ADJUDICATION
   When claim approved/paid: ReconciliationService compares real_time_plan_paid vs final
   → Release additional, recover, or flag for manual
```

### 8.3 EOB and Settlement

- **EOB**: `EOBCalculationService` computes allowed amount, plan paid, deductible, copay, coinsurance from eligibility + fee schedule.
- **Settlement**: `SettlementService.getSettlementDecision()` uses aggregate coding confidence Φ to decide:
  - **full**: Release R_plan (Φ ≥ θ_high)
  - **partial**: Release R_plan × Φ (θ_low ≤ Φ < θ_high)
  - **hold**: Release 0, escrow R_plan (Φ < θ_low)

---

## 9. Medical Reasoning → Billing Interaction

Medical reasoning (coding, triage) directly drives billing behavior.

### 9.1 Coding → Pricing

```
suggest_codes_from_symptoms (or search_*_codes)
    │
    ▼
getCodeCandidates() / getCandidatesForCoding()
    │
    ├─ Colab RAG (when RAG_API_URL set)
    └─ Local keyword + phrase search
    │
    ▼
Returns: { icd10, cpt, hcpcs } with { code, description, confidence }
    │
    ▼
get_code_pricing(cpt_codes, payer_id)
    │
    ▼
FeeScheduleService.getAllowedAmountsForCodes(payer_id, cpt_codes)
    │
    ▼
fee_schedules table → allowed_amount per (payer_id, cpt_code)
    │
    ▼
EOBCalculationService uses allowed amounts for line items
```

### 9.2 Coding Confidence → Settlement

- **Settlement confidence** Φ is derived from per-code confidence (φ_i) from the coding pipeline.
- `SettlementRulesService.evaluateSettlementRules()` uses `codingBand` and `codingConfidence` from `claimDetails`.
- Low confidence → manual review or partial release; high confidence → auto-approve.

### 9.3 Triage → Scheduling

- `assess_urgency()` returns EMERGENT / URGENT / ROUTINE.
- `handleScheduleAppointment()` calls `checkBeforeScheduling(recentTurns)`.
- If EMERGENT: scheduling blocked; agent instructs caller to call 911 / go to ER.

---

## 10. FHIR Resources & Data Flow

FHIR resources are **stored locally** in SQLite (or Postgres), not in Azure Healthcare FHIR. The platform uses FHIR R4-compliant structures for interoperability.

### 10.1 Storage

| Table | Resource | Purpose |
|-------|----------|---------|
| `fhir_patients` | Patient | Demographics, phone, email, `patient_wallet_address`, `merchant_id` |
| `fhir_encounters` | Encounter | Voice/video encounters; `call_id`, `patient_id`, `start_time`, `status` |
| `fhir_communications` | Communication | Call transcripts (encounter_id → messages) |
| `fhir_observations` | Observation | Assessments (PHQ-9, GAD-7, etc.) |
| `fhir_diagnostic_reports` | DiagnosticReport | Video consult AI assessments |

### 10.2 Voice Call → FHIR Flow

```
Twilio receives call → POST /voice/incoming
    │
    ├─ Immediate: Return TwiML (Dial to Retell SIP)
    │
    └─ setImmediate (async, non-blocking):
          │
          ▼
      FHIRAdapter.retellCallToFHIR({ call_id, from_number, to_number, metadata })
          │
          ▼
      FHIRService.processVoiceCall(callData)
          │
          ├─ getOrCreatePatient (by phone) → fhir_patients
          │
          └─ createEncounter ({ patientId, callId, ... }) → fhir_encounters
```

- **Patient**: Created or looked up by phone; `call_id` is associated via encounter.
- **Encounter**: Links `Patient`, `call_id`, timestamps; `call_id` stored in extension.

### 10.3 FHIR ↔ Appointments & Claims

- **Appointments**: `BookingService.scheduleAppointment()` calls `FHIRService.getOrCreatePatient()`; `appointments.patient_id` = `fhir_patients.resource_id`.
- **Claims**: `insurance_claims.patient_id` references `fhir_patients.resource_id`.
- **Eligibility**: `eligibility_checks.patient_id` references `fhir_patients.resource_id`.
- **Benefits**: `GET /api/patients/:patientId/benefits` joins `fhir_patients`, `patient_insurance`, `eligibility_checks`.

### 10.4 FHIR Resource Creation (Templates)

- `models/fhir-resources.js`: `createPatient()`, `createEncounter()`, `createCommunication()`, `createObservation()`.
- Output is HL7 FHIR R4 JSON; stored in `resource_data` (JSON) in DB.

---

## 11. Azure Domain Services

**Naming clarification**: “Azure Domain Services” in this codebase refers to **`AzureDomainService`** (`middleware-platform/services/azure-domain-service.js`), which manages **custom domains and SSL** for tenant subdomains on **Azure App Service**. It is **not** Azure Healthcare FHIR Service or Azure Active Directory Domain Services.

### 11.1 What AzureDomainService Does

| Function | Purpose |
|----------|---------|
| `addCustomDomain(subdomain, rootDomain, appName, resourceGroup)` | Add `{subdomain}.doclittle.site` to Azure App Service |
| `createSSLCertificate(...)` | Create managed SSL certificate for subdomain |
| `bindSSLCertificate(...)` | Bind certificate to domain |
| `setupTenantDomain(subdomain)` | End-to-end: domain + SSL for new tenant |

### 11.2 When It Runs

- On tenant signup: `setupTenantDomain(tenantSubdomain)`.
- Requires Azure CLI and `AZURE_APP_NAME`, `AZURE_RESOURCE_GROUP`, `AZURE_ROOT_DOMAIN`.

### 11.3 Relationship to FHIR

- **FHIR** is stored in local DB (`fhir_patients`, `fhir_encounters`, etc.).
- **Azure** hosts the middleware app (App Service); `AzureDomainService` configures `tenant.doclittle.site` → that app.
- There is no Azure Healthcare FHIR integration in the current codebase.

---

## 12. Related Documentation

| Document | Contents |
|----------|----------|
| `docs/architecture/README.md#financial-financial-layer-architecture` | Full financial layer, Stedi, coding pipeline, Tiba spec |
| `docs/architecture/README.md#voice-agent-state-flow` | Medical coding state machine |
| `docs/architecture/README.md#voice-agent-voice-agent-todo-and-status` | Implementation status |
| [`docs/middleware-platform/README.md`](../middleware-platform/README.md#voice-agent-functions-and-dynamic-variables) | Voice tools and dynamic variables |
| `todos/pending/PRODUCTION_READINESS_TASKS.md` | Production readiness checklist, Azure setup, compliance |

- [FINANCIAL_LAYER_ARCHITECTURE.md](./README.md#financial-financial-layer-architecture) — Stedi, coding pipeline, EOB, settlement, voice tools
- [STATE_FLOW.md](./README.md#voice-agent-state-flow) — Medical coding state machine
- [Voice agent functions (consolidated middleware docs)](../middleware-platform/README.md#voice-agent-functions-and-dynamic-variables) — All Retell functions and dynamic variables
- [pending/PRODUCTION_READINESS_TASKS.md](../../todos/pending/PRODUCTION_READINESS_TASKS.md) — Tasks to be production-ready, including Azure setup


---

<a id="overview-hybrid-architecture-improvements"></a>

## Hybrid Architecture — Improvements (Implemented)

*Former path: `docs/architecture/overview/HYBRID_ARCHITECTURE_IMPROVEMENTS.md`*

**Last Updated:** April 6, 2026

This doc listed planned improvements for the hybrid Voice + Video + PDF + RAG setup. **All items below are implemented.** For current architecture and boundaries, see **[HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md)**.

---

## Implemented

| # | Item | Status |
|---|------|--------|
| 1 | **Unify get-code pipeline** | `knowledgeService.getCodeCandidatesDualSource()` — remote RAG + local in parallel, merge, validate. Used by video graph and assistant. |
| 2 | **Circuit breaker for remote RAG** | `remote-rag-client.js` uses `utils/circuit-breaker.js` (name `remote_rag`). Env: `RAG_CIRCUIT_FAILURE_THRESHOLD`, `RAG_CIRCUIT_WINDOW_MS`, `RAG_CIRCUIT_RESET_MS`. |
| 3 | **Observability (coding pipeline)** | `retrieve_context` node returns `processing_metadata`: `remote_count`, `local_count`, `merged_count`; telemetry adds node duration. Visible in LangSmith. |
| 4 | **Persist transcript on end_session** | Graph returns `audio_transcript`; route passes it in `endSession(room, { ...result })`; `getSessionState` uses `meta.audio_transcript`. |
| 5 | **Single code shape at boundary** | All code arrays use `{ code, description, confidence }`; validation in shared pipeline; `invalid_codes` when applicable. |
| 6 | **Translate before RAG (optional)** | Documented in HYBRID_ARCHITECTURE_OVERVIEW.md §6; code comment in video-consult-graph at RAG call. English-only coding until translate step added. |
| 7 | **Idempotency for end_session** | Route checks `session?.session_status === 'ended'`; if so, returns success + last result from metadata without re-running graph. |
| 8 | **One-page hybrid diagram** | [HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md) — diagram, summary table, boundaries. |

---

## Reference (original plan)

The original improvement plan is preserved in git history. Priority order was: §1 → §4 → §2 → §5 → §3 → §8 → §7 → §6.


---

<a id="overview-hybrid-architecture-overview"></a>

## Hybrid Architecture — One-Page Overview

*Former path: `docs/architecture/overview/HYBRID_ARCHITECTURE_OVERVIEW.md`*

**Context:** Doctor Little uses multiple entry points (Voice, Video, PDF) that share coding, RAG, and FHIR. This doc answers “where does this run?” and “how are codes obtained?” in one place.

---

## Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                                           │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  VOICE (Retell)                    VIDEO (LiveKit)                 PDF                   │
│  ┌─────────────┐                   ┌─────────────────┐            ┌─────────────────┐   │
│  │ WebSocket   │                   │ Python agents   │            │ Coding          │   │
│  │ tool calls  │                   │ transcript /    │            │ orchestrator    │   │
│  │             │                   │ vision_frame /  │            │ (extract text)  │   │
│  │             │                   │ end_session     │            │                 │   │
│  └──────┬──────┘                   └────────┬────────┘            └────────┬────────┘   │
│         │                                  │                                │           │
└─────────┼──────────────────────────────────┼────────────────────────────────┼───────────┘
          │                                  │                                │
          ▼                                  ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  MIDDLEWARE PLATFORM                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  Voice:                          Video:                                                │
│  • tools → getCodeCandidates     • POST /api/video-consult/agent-events                 │
│    (local + optional Colab RAG)  • video-consult LangGraph:                             │
│  • optional coding-graph           accumulate → retrieve_context → human_review →       │
│    (LangGraph)                      store_fhir                                          │
│                                    • retrieve_context = getCodeCandidatesDualSource      │
│                                                                                         │
│  PDF: getCandidatesForCoding (Colab RAG + local fallback)                              │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
          │                                  │                                │
          └──────────────────┬───────────────┴────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  SHARED                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  • knowledge-service    getCodeCandidates, getCodeCandidatesDualSource, validateCodes   │
│  • remote-rag-client    Colab RAG (circuit breaker), returns { icd10, cpt, hcpcs }       │
│  • FHIR service         Encounter, Communication, audit                                 │
│  • LangSmith            Traces: video consult graph nodes, coding pipeline metadata     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary Table

| Entry point   | How codes are obtained                                                                 | State / persistence                    | Traced (LangSmith)                          |
|--------------|-----------------------------------------------------------------------------------------|----------------------------------------|---------------------------------------------|
| **Voice**    | Tools call `knowledgeService.getCodeCandidates()`; optional coding-graph LangGraph     | Call state, coding_decisions           | If LangGraph used; tool calls in Retell      |
| **Video**    | `getCodeCandidatesDualSource()` in graph node (remote RAG + local, merge, validate)   | LangGraph checkpointer, session metadata, FHIR | Graph runs, retrieve_context metadata (remote_count, local_count, merged_count) |
| **PDF**      | `getCandidatesForCoding()` (Colab RAG + local fallback, guideline filter)               | Job/request scope                      | As configured for coding pipeline            |

---

## Key Boundaries

- **Single “get codes” path for video/assistant:** `knowledgeService.getCodeCandidatesDualSource(clinicalText, options)` — remote + local in parallel, merge, validate; boundary shape `{ code, description, confidence }`.
- **Circuit breaker:** Remote RAG wrapped in `utils/circuit-breaker.js` (e.g. `remote_rag`); when open, local-only.
- **Idempotency:** Duplicate `end_session` for the same room returns last result without re-running the pipeline.
- **Transcript:** On `end_session`, transcript is stored in session metadata (`audio_transcript`) so post-call UI and assistant see the same text used for RAG.

See **HYBRID_ARCHITECTURE_IMPROVEMENTS.md** for the improvement plan and **VIDEO_CONSULT.md** for video flow, env, and runbook.

---

**Last Updated:** April 6, 2026

---

## Translate before RAG (optional, §6)

**Current:** Coding and RAG (terminology, phrase matching) are English-oriented. Video consult sends the raw transcript to `getCodeCandidatesDualSource` with no language detection or translation.

**To support non-English consults:** Add an optional step before `retrieve_context`: if the transcript language is not English (e.g. from STT config or a small detector), call the perception layer’s `extractAndNormalizeText()` or a translate-only path and pass the normalized/translated text into `getCodeCandidatesDualSource`. Until then, document “English only for coding” (see **VIDEO_CONSULT.md** §3 STT/language).


---

<a id="overview-rag-integration-approaches"></a>

## RAG Integration: File Extraction vs Translation Layer

*Former path: `docs/architecture/overview/RAG_INTEGRATION_APPROACHES.md`*


**Context**: Middleware runs 24/7 on Azure. Colab is ephemeral—it cannot run as a live RAG server. Two approaches compared against the current implementation.

---

## Current Implementation (What Exists)

### 1. Live RAG Path (Designed for Colab/Render)

| Component | Location | Expectation |
|-----------|----------|-------------|
| `remote-rag-client.js` | `services/layer2-rag/` | `POST RAG_API_URL/retrieve` → expects `{ icd10: [...], cpt: [...], hcpcs: [...] }` |
| `knowledge-service.js` | `getCandidatesForCoding()` | If `RAG_API_URL` set → call Colab; else local fallback |
| `rag-proxy.js` | `routes/` | Forwards `/api/rag/*` to `COLAB_RAG_URL` |

**Problem**: Colab cannot stay running. `RAG_API_URL` would need a deployed service (Render, GCP, etc.), not Colab.

### 2. Local Knowledge (Already Works)

| File/Source | Loaded By | Purpose |
|-------------|-----------|---------|
| `icd10_reference.json` | knowledge-service | ICD-10 fallback (~271 codes) |
| `icd10_codes` table | DB | Primary ICD-10 search (~72K codes) |
| `cpt_codes` table | DB | CPT search |
| `hcpcs_codes` table | DB | HCPCS search |
| `medical-abbreviations.json` | knowledge-service | SOB→shortness of breath, etc. |
| `medical-entities.json` | knowledge-service | Synonyms, severity |
| `extraction-patterns.json` | knowledge-service | Regex for symptoms, vitals |
| `simple-coding-rules.json` | knowledge-service | Clinical pattern → ICD/CPT |
| `triage-rules.json` | triage-service | Emergent/urgent patterns |

**Hardcoded** (not file-based): `MEDICAL_PHRASES`, `PHRASE_EXPANSIONS` in knowledge-service.js (lines 196–219).

### 3. Colab-Generated Files (Present but Unused)

| File | Location | Content |
|------|----------|---------|
| `code_expansion_map.json` | `Knowledge/RAG/` | ICD parent→child expansions (e.g. G89 → G89.0, G89.1, …) |
| `terminology_lookup.json` | `Knowledge/RAG/` | CPT codes with positive_terms, anatomical, specialties, sample_sources from clinical guidelines |

**Gap**: These files exist but are **not loaded** by the middleware. Grep shows no references.

---

## Approach A: File Extraction (Recommended for Colab + Azure)

**Idea**: Colab runs periodically (e.g. weekly) to generate/update knowledge files. You export those files and add them to the middleware repo. Middleware loads them at startup—no live RAG connection.

### Why It Fits Your Setup

- Middleware on Azure runs 24/7 with no dependency on Colab.
- Colab is used as a batch job: process ontology, clinical guidelines, code expansions → output JSON files.
- You version-control the exported files in the repo and deploy with the app.
- No `RAG_API_URL`, no rag-proxy, no circuit breaker for remote RAG.

### Implementation Steps (Post–7A)

#### Step 1: Colab Export Contract

Define a stable output format and location.

**Option 1A – Single merged file** (simplest):

- Colab writes: `Knowledge/RAG/colab-export.json`
- Shape:
  ```json
  {
    "phrase_expansions": { "well child": ["routine child health"], "type 2 diabetes": ["E11"], ... },
    "medical_phrases": ["type 2 diabetes", "well child", ...],
    "code_expansions": { "G89": ["G89.0","G89.1",...], ... },
    "term_to_codes": { "creatinine clearance": ["01667"], "anesthesia kidney ureter bladder": ["00834"], ... }
  }
  ```

**Option 1B – Multiple files**:

- `Knowledge/RAG/phrase_expansions.json` — overrides PHRASE_EXPANSIONS
- `Knowledge/RAG/code_expansion_map.json` — already exists
- `Knowledge/RAG/terminology_lookup.json` — already exists (term → CPT hints)
- `Knowledge/ontology/colab-phrases.json` — optional MEDICAL_PHRASES extension

#### Step 2: Colab Notebook Export Logic

At the end of your Colab pipeline:

```python
# After building phrase expansions, code map, terminology from chunks
import json

export = {
    "phrase_expansions": phrase_expansions_dict,
    "medical_phrases": list(medical_phrases_set),
    "code_expansions": code_expansion_map,  # from icd10 metadata
    "term_to_codes": term_to_codes  # from terminology_lookup: term -> [cpt_codes]
}

with open("colab-export.json", "w") as f:
    json.dump(export, f, indent=2)

# Or: download via files.download("colab-export.json")
```

#### Step 3: Middleware Loader

Add a loader in `knowledge-service.js` (or a small `rag-file-loader.js`):

```javascript
const COLAB_EXPORT_PATH = path.resolve(__dirname, '../../Knowledge/RAG/colab-export.json');
const CODE_EXPANSION_PATH = path.resolve(__dirname, '../../Knowledge/RAG/code_expansion_map.json');
const TERMINOLOGY_LOOKUP_PATH = path.resolve(__dirname, '../../Knowledge/RAG/terminology_lookup.json');

let colabPhraseExpansions = {};
let colabCodeExpansions = {};
let colabTermToCodes = {};

function loadColabExports() {
  // Load colab-export.json (single file) or individual files
  if (fs.existsSync(COLAB_EXPORT_PATH)) {
    const raw = fs.readFileSync(COLAB_EXPORT_PATH, 'utf8');
    const data = JSON.parse(raw);
    colabPhraseExpansions = data.phrase_expansions || {};
    colabCodeExpansions = data.code_expansions || {};
    colabTermToCodes = data.term_to_codes || {};
    console.log(`✅ Loaded Colab export: ${Object.keys(colabPhraseExpansions).length} phrase expansions, ${Object.keys(colabTermToCodes).length} term→code mappings`);
  }
  // Fallback: load existing files if present
  if (Object.keys(colabCodeExpansions).length === 0 && fs.existsSync(CODE_EXPANSION_PATH)) {
    const raw = fs.readFileSync(CODE_EXPANSION_PATH, 'utf8');
    const data = JSON.parse(raw);
    colabCodeExpansions = data.icd10 || {};
  }
  // ... similar for terminology_lookup
}
```

#### Step 4: Wire Into Search

- **Phrase expansions**: Merge `colabPhraseExpansions` with `PHRASE_EXPANSIONS` in `extractMedicalPhrases()`.
- **Code expansions**: When returning ICD-10 candidates, expand parent codes using `colabCodeExpansions` (e.g. if "G89" is in results, add G89.0, G89.1, etc.).
- **Term→CPT**: When extracting keywords from a note, check `colabTermToCodes`. If a term matches, look up CPT codes from DB and boost their rank.

#### Step 5: Deployment Workflow

1. Run Colab notebook when you add/change ontology, guidelines, or code mappings.
2. Export `colab-export.json` (or the chosen file set).
3. Copy into `Knowledge/RAG/` (or `Knowledge/ontology/`).
4. Commit and push; Azure deployment picks up the new files.

### Pros and Cons

| Pros | Cons |
|------|------|
| No dependency on Colab runtime | Knowledge is not real-time (batch refresh) |
| Works with Azure-only deployment | Requires manual export/deploy step |
| Versioned knowledge in git | Colab export format must stay stable |
| Uses existing Colab-generated files | |

---

## Approach B: Translation Layer (For a Deployed RAG Service)

**Idea**: RAG runs on a persistent service (Render, GCP, etc.), not Colab. RAG returns chunks with metadata (`icd10_codes`, `entities_procedures`). A translation layer converts that to `{ icd10, cpt, hcpcs }` for the middleware.

### Gap

- Middleware expects: `{ icd10: [{ code, description, confidence }], cpt: [...], hcpcs: [...] }`
- RAG returns: chunks with metadata, e.g. `metadata.icd10_codes`, `metadata.entities_procedures`
- CPT is not in the Pinecone index (clinical corpus, not CPT codebook), so CPT comes from local DB.

### Where the Translation Lives

**Option B1 – In the RAG service** (recommended):

- RAG service receives `POST /retrieve` with `{ query, specialty, top_k }`.
- Queries Pinecone → gets chunks with metadata.
- Aggregates `icd10_codes` from chunk metadata (count occurrences, rank by confidence).
- Returns `{ icd10: [...], cpt: [], hcpcs: [] }` (CPT empty; middleware fills from local).
- Middleware stays unchanged.

**Option B2 – In the middleware**:

- Add a translation step in `remote-rag-client.js`.
- Accept a new RAG response shape: `{ chunks: [{ metadata: { icd10_codes: [...] } }] }`.
- Aggregate and convert to `{ icd10, cpt, hcpcs }` before returning to `getCandidatesForCoding()`.
- Requires changing the contract so the RAG can return raw chunks.

### Translation Logic (Pseudocode)

```javascript
// In RAG service or middleware translation layer
function chunksToCodes(chunks) {
  const icd10Counts = new Map();  // code -> { count, totalChunks }
  for (const c of chunks) {
    const codes = c.metadata?.icd10_codes || [];
    for (const code of codes) {
      icd10Counts.set(code, (icd10Counts.get(code) || 0) + 1);
    }
  }
  // Rank by frequency, return top-k with confidence = normalized count
  const sorted = [...icd10Counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top_k)
    .map(([code, count]) => ({
      code,
      description: getDescriptionFromDB(code),  // or from chunk text
      confidence: Math.min(1, count / chunks.length + 0.5)
    }));
  return { icd10: sorted, cpt: [], hcpcs: [] };  // CPT from local DB
}
```

### Pros and Cons

| Pros | Cons |
|------|------|
| Real-time retrieval from Pinecone | RAG must run 24/7 (Render, GCP, etc.) |
| Semantic search over clinical corpus | Additional hosting cost |
| Reuses existing middleware contract | Colab still cannot be the RAG host |

---

## Recommendation

| Scenario | Approach |
|----------|----------|
| Colab-only, middleware on Azure | **Approach A (file extraction)** |
| Deployed RAG (Render/GCP) in addition to Colab | **Approach B (translation layer)** in the RAG service |
| Hybrid | Use A for phrase/code expansions; use B for semantic retrieval when RAG is deployed |

---

## Immediate Action: Approach A Steps

1. **Define Colab export format**  
   - Choose single-file (`colab-export.json`) or multi-file.
   - Document the schema.

2. **Add loader in knowledge-service.js**  
   - Load from `Knowledge/RAG/` (and optionally `Knowledge/ontology/`).
   - Merge with existing `PHRASE_EXPANSIONS`, `MEDICAL_PHRASES`.
   - Use `code_expansion_map.json` for ICD expansion.
   - Use `terminology_lookup.json` for term→CPT boosting (if structure allows).

3. **Wire into `extractMedicalPhrases()` and `getCandidateIcd10Codes()`**  
   - Prefer Colab exports over hardcoded values when present.

4. **Document the workflow**  
   - When to run Colab.
   - How to export and where to place files.
   - How to deploy to Azure.

5. **Leave `RAG_API_URL` unset in production**  
   - Use local-only path so the system is self-contained on Azure.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `Knowledge/RAG/colab-export.json` | Create (or use existing files); Colab output |
| `knowledge-service.js` | Add `loadColabExports()`, wire into phrase extraction and ICD expansion |
| `docs/architecture/RAG_COLAB_EXPORT_WORKFLOW.md` | Create workflow doc |
| `remote-rag-client.js` | No change for Approach A (RAG not used) |
| `rag-proxy.js` | No change for Approach A (optional to remove if never used) |


---

<a id="patients-local-test-runbook"></a>

## Local Test Runbook — Patient Journey & Landing

*Former path: `docs/architecture/patients/LOCAL_TEST_RUNBOOK.md`*

**Last Updated:** April 6, 2026

Merged from: LOCAL_E2E_RUNBOOK, LOCAL_LANDING_TEST_FLOW.

---

## 1. Start Middleware

```bash
cd middleware-platform
DB_PATH=./middleware-dev.db npm start
# or: npm run dev
```

API at `http://localhost:4000`.

---

## 2. Option A: Voice → Payment → Video (E2E)

1. **Create voice appointment** — Retell/Twilio flow or script → `voice_checkouts` + `appointments` rows
2. **Capture links** — Login + payment links from email/console
3. **Patient login** — `patient-login.html` → email + 6-digit code
4. **Onboarding** — `onboarding.html` (profile, insurance, documents)
5. **Appointments + payment** — `appointments.html` → Pay now → complete
6. **Video visit** — Join video → complete → `createDiagnosticReportForAppointment`

---

## 3. Option B: Landing + Portal (LittleLab)

1. **Seed data:**
   ```bash
   npm run seed:demo
   npm run seed:patient-demo
   ```
2. **Landing** — `http://localhost:4000/` → search → "I'm a Patient"
3. **Login** — `patient@doclittle.com` + code from logs
4. **Onboarding** — Complete 3 steps
5. **Dashboard** — Verify seeded appointment, wallet
6. **Provider** — Log in as `provider@doclittle.com` / `demo123` → see same appointment

---

## 4. Fresh Run

```bash
rm ./middleware-dev.db
DB_PATH=./middleware-dev.db npm run dev
npm run seed:demo
npm run seed:patient-demo
```


---

<a id="patients-patient-architecture"></a>

## Patient Architecture — Voice, Chat, UI & Session

*Former path: `docs/architecture/patients/PATIENT_ARCHITECTURE.md`*

**Last Updated:** April 6, 2026

Merged from: PATIENT_VOICE_BOOKING_ARCHITECTURE, TRIAGE_SESSION_SCOPE, PATIENT_UI_SOURCE_OF_TRUTH.

---

## 1. 9-Step Patient Booking Flow

```
1. Multi-Modal Front Door (Voice + Chat) → Kelly/Orchestrator
2. Case Report (OPQRST) → Triage
3. Triage & Lane (Emergency | Sync Video | Async)
4. Availability Matching → Slots
5. Payment Gate
6. Reminders (24h, 1h, tech check)
7. Telemedicine Encounter (LiveKit)
8. Case Report & Handoff
9. Feedback Loop
```

**Entry Points:** `POST /api/patient/triage/message`, Retell WebSocket → `handlePatientTriageMessage`. Kelly (LLM) primary; PatientOrchestrator fallback.

---

## 2. Triage Session Scope (orch-13)

| Storage | Key | Purpose |
|--------|-----|---------|
| sessionStorage | `patient_triage_state_v1` | triageState (session_id, flow_state) — **tab-scoped** |
| localStorage | `patient_session_id` | Portal auth |
| Server (DB) | `patient_orchestrate_sessions` | Canonical session |

**Resumability:** Same tab ✅; New tab/refresh ❌ (sessionStorage cleared). Recommendation: store `session_id` in localStorage for cross-tab resume.

---

## 3. Patient Portal UI — Source of Truth

**Reference:** `unified-dashboard/patients/patient-dashboard.html`

**Layout:** Fixed sidebar (260px), main content. Theme: `--primary: #1e40af`.

**Sidebar nav (6 items):** Dashboard, My Benefits, My Wallet, Bills & Claims, Appointments, My Records.

**Pages to align:** patient-dashboard, appointments, wallet, my-records, onboarding, triage — all use same shell, theme, footer ("Patient Account").


---

<a id="patients-patient-orchestrator-triage-provenance"></a>

## Patient Orchestrator — `session_id` vs `triage_sessions` (C1 / impl-5)

*Former path: `docs/architecture/patients/PATIENT_ORCHESTRATOR_TRIAGE_PROVENANCE.md`*

## Provenance

- **`patient_orchestrate_sessions.session_id`** is the orchestrator’s own session key (chat/voice fallback flow). It is **not** automatically the same as **`triage_sessions.session_id`** (Kelly clinical session / Retell `callId`), but in **voice** flows they are often **the same string** (e.g. Retell `callId` reused as orchestrator session id).

## Product decision (implemented)

**When `db.getTriageSession(session.session_id)` returns a row**, the orchestrator runs **`evaluateTriageGuardrailsForSession(session.session_id, {}, 'schedule')`** from **`services/voice-triage-guards.js`** **before** **`BookingService.scheduleAppointment`**. This matches **`POST /voice/appointments/schedule`** DB gates (safety, triage complete, confidence, OPQRST, intake).

**When no `triage_sessions` row exists** for `session.session_id`, booking **proceeds** without those gates (orchestrator-only / non-Kelly flows). This avoids blocking flows that never created triage.

**Blocked booking:** returns a user-facing reply with `triage_guard_blocked: true` and `error_code` from the guard (e.g. `TRIAGE_INCOMPLETE`, `TRIAGE_NOT_STARTED`, `OPQRST_REQUIRED`). Ops counter: **`orchestrator_triage_guard_blocked`** (best-effort).

## Audit note

- **`autoCheckoutAfterSchedule`** forwards **`triage_session_id: session.session_id`** for HTTP audit — correlation only, not proof of triage completeness.

## Env overrides

- None required for C1. To **force** stricter behavior (e.g. require a triage row for all orchestrator bookings), that would be a product follow-up and **not** implemented here.


---

<a id="patients-patient-wallet"></a>

## patients/PATIENT_WALLET

*Former path: `docs/architecture/patients/PATIENT_WALLET.md`*

## Patient Wallet (MVP + future)

### Purpose
The **Wallet** is the patient’s financial home in the Patient Portal:

- **Receipts**: history of payments / invoices for visits.
- **Payment methods**: card on file (cash-only MVP).
- **Balances**: show if any visit has payment due.

### MVP assumptions (cash-only)
- The patient can pay per-visit using a card/payment method (no insurer payout flows yet).
- The Wallet UI reads:
  - Receipts from `GET /api/patient/receipts`
  - Payment-due signals from `GET /api/patient/appointments` (`payment_status`)
- The Insurance UI is shown as **Coming soon** and does not block the cash-only flow.

### Future integrations (not implemented yet)
- Clearinghouse/eligibility/ERA integrations (e.g. Stedi) can enrich Wallet with:
  - Copay / deductible / coinsurance breakdowns
  - Claim status and remittance details
  - Insurer → patient payments and credits

### UX rules
- **Receipts belong in Wallet**, not in Visits/Appointments.
- **Payment card belongs in Wallet**, not on the Dashboard.
- **Help belongs in Profile** (wallet stays financial-only).



---

<a id="payments-payment-architecture"></a>

## Payment Architecture Overview

*Former path: `docs/architecture/payments/PAYMENT_ARCHITECTURE.md`*

## Two Separate Payment Systems

### 1. **Circle API Wallets** (Already Implemented ✅)
**Purpose**: USDC cryptocurrency payments for **insurance claims**

**Flow**:
- Insurance claim gets approved
- Insurer pays provider via Circle (USDC transfer)
- Provider receives USDC in their Circle wallet
- Used for healthcare billing/insurance reimbursements

**Status**: ✅ **FULLY IMPLEMENTED**
- Wallet creation
- Balance checking
- USDC transfers
- Webhook verification

---

### 2. **Payment Methods** (TODOs - Different System)
**Purpose**: Traditional card payments for **appointments/products**

**Current Status**:
- ✅ **Link-based payment** (working) - Email verification → Payment page
- ❌ **Direct Stripe** (TODO) - Direct payment intent
- 🔄 **Mastercard Agent Pay** (Implemented – requires credentials) - Voice commerce integration
- 🔄 **Visa Agent Toolkit** (Implemented – requires credentials) - Voice commerce integration

**These are for**:
- Patient pays for appointments ($39.99)
- Patient pays for products/services
- Voice agent purchases
- AI commerce transactions

---

## Payment Method Implementation Details

### Current: Link-Based Payment (Working ✅)

**Flow**:
1. Create checkout → Generate verification code
2. Email code to patient
3. Patient verifies code → Get payment link
4. Patient clicks link → Stripe payment page
5. Patient enters card → Payment processed

**Code**: `_handleLinkPayment()` in `payment-orchestrator.js`

---

### TODO 1: Direct Stripe Payment Intent

**What it does**: Process payment immediately without email verification step

**Implementation**:
```javascript
static async _handleStripePayment(checkout, merchant, paymentRequest) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
        amount: checkout.amount * 100, // Convert to cents
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
            checkout_id: checkout.id,
            merchant_id: merchant.id
        }
    });
    
    return {
        success: true,
        payment_intent_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        requires_action: paymentIntent.status === 'requires_action'
    };
}
```

**When to use**: When you have card details already (e.g., saved cards, direct API calls)

---

### Mastercard Agent Pay ✅ (Implemented)

**What it does**: Voice commerce payment protocol from Mastercard

**Implementation** (in `payment-orchestrator.js` + `mastercard-agent-pay-service.js`):
- `_handleMastercardPayment`: mandate verification → authorization → payment
- Fallback to link payment when not configured or mandate missing
- Env: `MASTERCARD_AGENT_PAY_API_URL`, `MASTERCARD_AGENT_PAY_API_KEY`, `MASTERCARD_AGENT_PAY_MERCHANT_ID`

**Usage**: Voice agent calls `create_checkout` with `payment_method: "mastercard"` and `mandate_id`

---

### Visa Agent Toolkit ✅ (Implemented)

**What it does**: Voice commerce payment protocol from Visa

**Implementation** (in `payment-orchestrator.js` + `visa-agent-toolkit-service.js`):
- `_handleVisaPayment`: mandate verification → authorization → payment
- Fallback to link payment when not configured or mandate missing
- Env: `VISA_AGENT_TOOLKIT_API_URL`, `VISA_AGENT_TOOLKIT_API_KEY`, `VISA_AGENT_TOOLKIT_MERCHANT_ID`

**Usage**: Voice agent calls `create_checkout` with `payment_method: "visa"` and `mandate_id`

---

## Summary

**Circle API Wallets** = ✅ Done (for insurance claims)
**Payment Methods** = Link ✅, Stripe ✅, Mastercard 🔄, Visa 🔄

### Shared / Infrastructure (4.x)

- **4.1 Payment method selection:** `PAYMENT_METHODS_ALLOWED` env; `GET /api/payment/methods`
- **4.2 Retell function:** `get_available_payment_methods` – returns configured methods for voice
- **4.3 Documentation:** See [PAYMENT_ENV_AND_FLOWS.md](./PAYMENT_ENV_AND_FLOWS.md) for env vars and flow diagrams
- **4.4 Security:** `payment-security.js` – log sanitization, credential checks, PCI scope



---

<a id="payments-payment-env-and-flows"></a>

## Payment Environment Variables & Flow Diagrams

*Former path: `docs/architecture/payments/PAYMENT_ENV_AND_FLOWS.md`*


## 4.3 Environment Variables

### Core (required for card payments)

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes (Stripe) | Stripe secret key for Payment Intents |
| `STRIPE_PUBLISHABLE_KEY` | Yes (Stripe) | Stripe publishable key for client-side |
| `STRIPE_WEBHOOK_SECRET` | Yes (prod) | Webhook signature verification |
| `BASE_URL` | Yes (links) | Base URL for payment links (e.g. `https://yoursite.com`) |

### Payment Method Selection (4.1)

| Variable | Default | Description |
|----------|---------|-------------|
| `PAYMENT_METHODS_ALLOWED` | `link,stripe` | Comma-separated: `link`, `stripe`, `mastercard`, `visa` |

### Mastercard Agent Pay

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTERCARD_AGENT_PAY_API_URL` | Yes | API base URL (sandbox or production) |
| `MASTERCARD_AGENT_PAY_API_KEY` | Yes | API key |
| `MASTERCARD_AGENT_PAY_MERCHANT_ID` | No | Merchant ID |

### Visa Agent Toolkit

| Variable | Required | Description |
|----------|----------|-------------|
| `VISA_AGENT_TOOLKIT_API_URL` | Yes | API base URL (sandbox or production) |
| `VISA_AGENT_TOOLKIT_API_KEY` | Yes | API key |
| `VISA_AGENT_TOOLKIT_MERCHANT_ID` | No | Merchant ID |

---

## Flow Diagrams

### Link Payment (default)

```
Voice/Web → create_checkout (payment_method=link)
    → Email verification
    → Payment link sent
    → User clicks link → Stripe page
    → Card entered → /process-payment
    → Payment Intent created/confirmed
    → Webhook payment_intent.succeeded
    → Checkout completed
```

### Direct Stripe

```
Voice/Web → create_checkout (payment_method=stripe, payment_method_id=pm_xxx)
    → _handleStripePayment
    → Payment Intent create + confirm
    → If requires_action → return client_secret
    → Client: stripe.confirmCardPayment(client_secret)
    → Webhook → Checkout completed
```

### Mastercard / Visa (voice commerce)

```
Voice → create_checkout (payment_method=mastercard|visa, mandate_id=xxx)
    → _handleMastercardPayment | _handleVisaPayment
    → verifyMandate
    → createAuthorization
    → processPayment
    → Checkout completed
```

### Payment Method Selection

```
Request payment_method
    → isPaymentMethodAllowed(method, merchantId)?
        → PAYMENT_METHODS_ALLOWED env
        → merchant.allowed_payment_methods (if set)
    → If not allowed → fallback to link
    → If allowed → route to handler
    → Handler checks credentials → fallback to link if not configured
```

---

## 4.4 Security

### Credential handling

- Never log `STRIPE_SECRET_KEY`, `MASTERCARD_AGENT_PAY_API_KEY`, `VISA_AGENT_TOOLKIT_API_KEY`
- Use `payment-security.sanitizeForLog()` before logging payment-related objects
- Sensitive fields redacted: `payment_method_id`, `client_secret`, `mandate_id`, `token`

### PCI scope

- **In scope:** `payment_method_id`, `client_secret`, `mandate_id`, `payment_token`
- **Never log:** card number, CVV, full PAN
- **Stored tokens:** Use tokenized IDs only; never store raw card data

### Token handling

- Payment links use cryptographically secure tokens (32-byte hex)
- Tokens expire (1 hour for payment links)
- Idempotency keys prevent duplicate charges


---

<a id="payments-payment-token-flow"></a>

## Payment Token Flow (Task 25)

*Former path: `docs/architecture/payments/PAYMENT_TOKEN_FLOW.md`*


## Overview

Payment links use a token stored in `payment_tokens` and resolved via `getPaymentToken`. The URL pattern is `/payment/{token}`.

## Flow

1. **Create checkout** – `create_checkout` (voice) or `POST /voice/appointments/checkout` creates a `voice_checkouts` row.
2. **Create token** – `db.createPaymentToken({ token, checkout_id, verification_code, verification_code_expires, status })` inserts into `payment_tokens`.
3. **Send link** – Email contains `{BASE_URL}/payment/{token}`.
4. **Resolve token** – `GET /payment/:token` serves the payment page; `GET /api/payment/checkout/:token` returns checkout details via `PaymentService.getCheckoutByToken(token)` which calls `db.getPaymentToken(token)`.
5. **Verify identity** (Task 53) – `verify_checkout_code` sets `status='verified'`, `identity_verified_at=now`. Payment is only allowed when status is `verified`.
6. **Charge** – `POST /api/payment/process` uses `payment_token`; validates via `getPaymentToken` and processes via Stripe.

## Tables

- `payment_tokens`: `token`, `checkout_id`, `verification_code`, `verification_code_expires`, `status`, `identity_verified_at`, `used_at`
- `voice_checkouts`: checkout details including `amount`

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /payment/:token` | Payment page (serves HTML) |
| `GET /api/payment/checkout/:token` | Fetch checkout by token |
| `POST /api/payment/process` | Process payment (requires `payment_token` in body) |

## Route Mapping

- `/payment/:token` in `server.js` → redirects to `/api/payment/:token` or serves payment page
- Payment routes live in `routes/payment.js` under `/api/payment`


---

<a id="providers-doctor-dashboard-rebuild-todos"></a>

## Doctor Dashboard Rebuild TODOs

*Former path: `docs/architecture/providers/DOCTOR_DASHBOARD_REBUILD_TODOS.md`*

This checklist covers the rebuild of the doctor portal dashboard around triage priority, provider tasks, schedule, and specialist consult workflows.

## P0 - Product and UX foundation

- [ ] Lock dashboard information architecture for doctor workflow:
  - Clinical Control strip (priority queue, matching, pending tasks, consults, readiness)
  - Today Tasks panel
  - Schedule panel
  - Consult Network panel (scaffold)
- [ ] Confirm no ecommerce-first metrics remain in doctor view (orders/AOV/conversion as primary KPIs).
- [ ] Define final doctor personas for dashboard behavior:
  - Solo specialist
  - Multi-specialist clinic doctor
  - Triage-assigned covering doctor
- [ ] Define card and list empty-states (no tasks, no consults, no schedule, unavailable readiness).

## P0 - Design system and icon migration (Tailwind/Heroicons only)

- [ ] Replace all non-Heroicon icons/emojis in doctor dashboard.
- [ ] Standardize icon mapping:
  - Queue: `ExclamationTriangleIcon`
  - Tasks: `ClipboardDocumentListIcon`
  - Schedule: `CalendarDaysIcon`
  - Consults: `UserGroupIcon`
  - Calls: `PhoneIcon`
  - Readiness: `CheckBadgeIcon`/`ExclamationCircleIcon`
- [ ] Add consistent icon size/stroke utility classes for desktop/mobile.
- [ ] Verify contrast and accessibility for icon + urgency chips.

## P0 - Data contract cleanup for doctor dashboard

- [ ] Define and document doctor dashboard API contract (single source for tiles + panels).
- [ ] Remove mismatch between shop metrics and clinic/provider metrics in doctor UI bindings.
- [ ] Ensure all dashboard metrics are tenant-scoped and provider-safe.
- [ ] Add versioned response shape for dashboard contract to prevent UI drift.

## P0 - Clinical Control strip (top KPIs)

- [ ] Add tile: high-priority triage queue counts (`red`, `yellow`, `green`).
- [ ] Add tile: unassigned matched cases count.
- [ ] Add tile: doctor pending tasks count.
- [ ] Add tile: today consults (`scheduled`, `in_progress`).
- [ ] Add tile: booking readiness (`live calendar`, `blocks-only`, `unavailable`).
- [ ] Add quick actions:
  - Open triage queue
  - Open today schedule
  - Open consult requests

## P0 - Today Tasks panel

- [ ] Build tabs:
  - Important
  - Pending
  - Waiting
  - Completed
- [ ] Support task item types:
  - Review triage summary
  - Accept/decline match
  - Complete SOAP note
  - Follow-up callback/message
  - Coding/billing completion
- [ ] Add task row metadata:
  - urgency tag
  - patient/case reference
  - due time
  - owner/source
- [ ] Add row actions:
  - Open case
  - Mark done
  - Reassign

## P0 - Schedule panel

- [ ] Build schedule cards grouped by time windows for today.
- [ ] Show lane tags (`sync`, `async review`, `consult requested`).
- [ ] Add quick actions:
  - Start consult
  - View chart
  - Request specialist consult
- [ ] Show no-show / in-progress / completed status colors.

## P1 - Consult Network scaffold

- [ ] Add section: outbound consult requests.
- [ ] Add section: inbound consult requests.
- [ ] Add section: cases needing second opinion.
- [ ] Add minimal actions:
  - Open case
  - Send consult request
  - Accept/decline consult request

## P1 - Backend data wiring (existing data first, no static mocks)

- [ ] Wire schedule data from provider schedule APIs/services.
- [ ] Wire booking readiness from `/api/provider/booking-readiness`.
- [ ] Wire observability summary from `/api/provider/booking-observability`.
- [ ] Wire upcoming appointments from tenant/provider scoped endpoints.
- [ ] Add triage queue query from `triage_sessions` (`urgency`, `safety_level`, `triage_complete`).
- [ ] Add pending task derivation from existing appointment + triage + consult/coding states.

## P1 - Interaction and workflow reliability

- [ ] Ensure clicking a task deep-links to the correct case/appointment context.
- [ ] Ensure provider identity/canonical profile is used consistently in all dashboard queries.
- [ ] Add optimistic UI updates for task status changes with rollback on failure.
- [ ] Ensure stale data handling with polling or refresh controls.

## P1 - Mobile and responsive behavior

- [ ] Build responsive two-column -> one-column collapse for mobile.
- [ ] Keep quick actions reachable above the fold on small screens.
- [ ] Preserve readability and tappable targets for task/schedule cards.
- [ ] Verify side menu + bottom interactions do not hide critical dashboard actions.

## P0 - Video consult UX redesign (telemedicine-first)

- [ ] Make provider video stage the primary canvas on `business/video-call.html` (full-width desktop, fullscreen-first mobile).
- [ ] Collapse non-critical side surfaces by default (Transcript, Case Report, Clinical panel) and reveal on explicit toggle.
- [ ] Add a single "Clinical panel" toggle with clear open/close state and keyboard-safe behavior.
- [ ] Convert right panel to an overlay drawer on desktop and bottom sheet on mobile (no horizontal clipping).
- [ ] Keep risk/safety alert visible even when drawers are closed, with quick jump to transcript.
- [ ] Keep primary call controls sticky and always reachable on mobile (mic/camera/leave/end-claim).
- [ ] Merge patient context into progressive disclosure flow so doctors can focus on live video first.
- [ ] Ensure no panel blocks local/remote video on initial room connect and auto-join flows.
- [ ] Validate responsive behavior on narrow widths (`<=768px`) and landscape phones.

## P2 - Observability and auditability

- [ ] Add dashboard load telemetry by panel (latency/error).
- [ ] Add task action audit events (opened, completed, reassigned).
- [ ] Add consult request audit trail events.
- [ ] Add alert on sustained readiness degradation (e.g., unavailable providers > threshold).

## P2 - Testing and rollout

- [ ] Add unit tests for dashboard data mappers and status-to-chip transforms.
- [ ] Add integration tests for provider states and task derivation.
- [ ] Add E2E test:
  - doctor sees urgent triage item
  - opens case
  - marks task done
  - schedule panel updates
- [ ] Add E2E test for blocks-only readiness messaging.
- [ ] Stage rollout:
  - feature flag new doctor dashboard
  - internal clinic validation
  - controlled tenant rollout
  - remove legacy dashboard bindings

## Definition of done

- [ ] Dashboard primary view is clinically oriented (triage/tasks/schedule/consult), not ecommerce-oriented.
- [ ] All doctor dashboard icons are Heroicons/Tailwind-compatible.
- [ ] No static/mock data in production path; all cards are DB/API-backed.
- [ ] Doctor can complete core daily loop from dashboard:
  - identify priority case
  - act on pending task
  - start or manage consult
  - track readiness/state quickly.


---

<a id="providers-provider-prescription-db-phase2-plan"></a>

## Provider/Prescription DB Rename Phase 2 Plan (Optional)

*Former path: `docs/architecture/providers/PROVIDER_PRESCRIPTION_DB_PHASE2_PLAN.md`*

## Objective
Provide a zero-downtime path to physical DB naming changes if desired.

## Recommended approach
1. Keep existing tables/columns as source of truth.
2. Add compatibility views (or query adapters) with provider/prescription names.
3. Migrate write paths to abstraction layer first.
4. Backfill/dual-write only if physical rename is required.
5. Cut over read paths.
6. Remove old names only after stability window.

## Candidate mappings
- `merchants` -> `providers`
- `products` -> `prescriptions`
- `merchant_orders` -> `provider_orders`
- `merchant_id` -> `provider_id`
- `product_id` -> `prescription_id`

## Risk controls
- Run all payment/auth regression suites before and after each step.
- Verify webhook handlers keep foreign key integrity.
- Keep rollback SQL/scripts ready for each migration step.

## Success criteria
- No increase in checkout failures.
- No increase in auth-related 4xx/5xx errors.
- All API contracts continue to accept legacy payloads through deprecation window.


---

<a id="providers-provider-prescription-naming-migration-guide"></a>

## Provider/Prescription Naming Migration Guide

*Former path: `docs/architecture/providers/PROVIDER_PRESCRIPTION_NAMING_MIGRATION_GUIDE.md`*

## Goal
- Move API/domain terminology from `merchant`/`product` to `provider`/`prescription`.
- Preserve backward compatibility for auth, checkout, and payments.

## Canonical Mapping
- `merchant` -> `provider`
- `merchant_id` -> `provider_id`
- `product` -> `prescription`
- `product_id` -> `prescription_id`

## Current Compatibility Contract
- Requests accept both legacy and new fields.
- Responses include both legacy and new fields for critical endpoints.
- Route aliases are available:
  - `/api/providers` (alias of `/api/merchant`)
  - `/api/prescriptions` (alias of `/api/products`)
  - `/api/public/prescriptions` (alias of `/api/public/products`)

## Migration Timeline
1. Phase 1 (now): Alias + dual-field responses.
2. Phase 2: Client adoption to provider/prescription fields.
3. Phase 3: Deprecation warning on legacy-only requests.
4. Phase 4: Optional physical DB rename (or keep compatibility indefinitely).

## Validation Checklist
- Public catalog works with `provider_id`.
- Public checkout works with `prescription_id`.
- Auth-protected routes still enforce existing security.
- Payment flow remains unchanged in behavior.


---

<a id="providers-provider-prescription-rollout-checklist"></a>

## Provider/Prescription Rollout Checklist

*Former path: `docs/architecture/providers/PROVIDER_PRESCRIPTION_ROLLOUT_CHECKLIST.md`*

## Pre-rollout
- [ ] Confirm route aliases mounted in target environment.
- [ ] Confirm OpenAPI shows new preferred fields.
- [ ] Confirm monitoring captures alias usage logs.

## Staged rollout
- [ ] Stage 1: Internal clients send both old + new fields.
- [ ] Stage 2: Frontend/storefront sends only new fields.
- [ ] Stage 3: External integrations migrate payloads.

## Guardrails
- [ ] Keep legacy endpoints/fields enabled during migration window.
- [ ] Add alert for checkout failure spikes.
- [ ] Add alert for auth failure spikes on products/prescriptions endpoints.

## Rollback plan
- [ ] Disable new client-side field usage (feature flag/env switch).
- [ ] Continue serving legacy responses without schema changes.
- [ ] Re-run smoke script `scripts/test-provider-prescription-aliases.js`.

## Production verification
- [ ] `GET /health` returns 200.
- [ ] `GET /api/public/prescriptions?provider_id=...` returns expected records.
- [ ] `POST /api/public/checkout/start` returns checkout payload with aliases.
- [ ] `GET /api/products` unauthenticated still returns 401.


---

<a id="readme"></a>

## Architecture Documentation

*Former path: `docs/architecture/README.md`*

System architecture, design decisions, and technical documentation.

---

## 📚 Documentation Index

### Vision & Overview
- **[vision/VISION.md](./README.md#vision-vision)** — Platform vision, goals, roadmap

### Core Architecture
- **[database/DATABASE_SCHEMA_APPROACH.md](./README.md#database-database-schema-approach)** — Database design, multi-tenancy
- **[multi-tenant/MULTI_TENANT_VOICE_AGENT.md](./README.md#multi-tenant-multi-tenant-voice-agent)** — Multi-tenant architecture
- **[payments/PAYMENT_ARCHITECTURE.md](./README.md#payments-payment-architecture)** — Payment processing, orchestrator

### Hybrid (Voice + Video + PDF)
- **[overview/HYBRID_ARCHITECTURE_OVERVIEW.md](./README.md#overview-hybrid-architecture-overview)** — One-page: entry points, how codes are obtained, shared RAG/FHIR, boundaries
- **[overview/HYBRID_ARCHITECTURE_IMPROVEMENTS.md](./README.md#overview-hybrid-architecture-improvements)** — Implemented improvements summary
- **[care-delivery/VIDEO_CONSULT.md](./README.md#care-delivery-video-consult)** — Video consult: flow, env vars, runbook (single doc)
- **[experience/LANDING_TRY_NOW_LIVEKIT.md](./README.md#experience-landing-try-now-livekit)** — Skin & Care landing Try now: camera + orb PiP, LiveKit token, not video-consult agents
- **[vision/VISION_UV_R_AND_D.md](./README.md#vision-vision-uv-r-and-d)** — UV imaging as separate hardware/calibration validation track

### Layer-Specific
- **[intelligence-layer/README.md](./README.md#intelligence-layer-readme)** — Multimodal medical AI (Layers 1–4), perception, RAG, coding agents
- **[financial/FINANCIAL_LAYER_ARCHITECTURE.md](./README.md#financial-financial-layer-architecture)** — Insurance, claims, EOB, coding, settlement, Tiba
- **[healthcare/HEALTHCARE_ASSESSMENT.md](./README.md#healthcare-healthcare-assessment)** — Healthcare platform assessment
- **[media/MEDIA_LAYER_ARCHITECTURE.md](./README.md#media-media-layer-architecture)** — Retell, Twilio, LiveKit
- **[ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md](./README.md#ai-langchain-langgraph-rag-architecture)** — LangChain, LangGraph, RAG, state, memory, evaluation

### Implementation & Maintenance
- **[middleware/MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md](./README.md#middleware-middleware-brain-improvements-implementation)** — Brain improvements implementation
- **[maintenance/ARCHITECTURE_ISSUES.md](./README.md#maintenance-architecture-issues)** — Known architecture issues
- **[FIXES_APPLIED.md](../archive/README.md#fixes-applied)** — Applied fixes log (archived)

### Voice Agent & Retell
- **[voice-agent/RUNBOOK.md](./README.md#voice-agent-runbook)** — Medical coding runbook
- **[voice-agent/TOOL_SCHEMAS.md](./README.md#voice-agent-tool-schemas)** — Retell function schemas
- **[voice-agent/AUTOMATED_RETELL_AGENT_CREATION.md](./README.md#voice-agent-automated-retell-agent-creation)** — Agent provisioning

### Financial Layer (Tiba)
- **[financial/TIBA_AND_BILLING_TODO.md](./README.md#financial-tiba-and-billing-todo)** — Tiba gaps, remediation, billing
- **[financial/STATIC_RECORDS_AUDIT.md](./README.md#financial-static-records-audit)**

### Stripe
- **[integrations/stripe/issuing/STRIPE_ISSUING.md](../../integrations/README.md#stripe-issuing-stripe-issuing)** — Stripe Issuing (consolidated)

---

## 🏗️ Architecture Overview

- **Multi-tenant** architecture
- **Voice-first** interface via Retell
- **Payment orchestration** layer
- **FHIR-compliant** healthcare data
- **Microservices** approach

---

## 🔗 Related Documentation

- **API:** `../api/README.md#api-documentation`
- **Deployment:** `../deployment/README.md#guides-deployment-guide`
- **Main Docs:** `../README.md`

---

**Last Updated:** April 13, 2026


---

<a id="vision-vision-uv-r-and-d"></a>

## Vision UV R&D (separate track)

*Former path: `docs/architecture/vision/VISION_UV_R_AND_D.md`*

**Last Updated:** April 8, 2026

UV-assisted skin imaging is a separate R&D stream from current RGB capture guidance.

## Why separate

- Standard webcams filter UV/IR; RGB feeds do not provide true UV reflectance/fluorescence.
- Software-only changes are insufficient for clinically meaningful UV interpretation.
- UV must not block current ROI/quality capture rollout.

## Required components

- Hardware: UV-capable illumination + compatible sensor/camera pipeline.
- Capture protocol: fixed distance/angle, exposure controls, ambient light constraints.
- Calibration: per-device normalization, reference targets, repeatability checks.
- Safety: patient instructions for UV exposure handling and contraindications.

## Validation gates before rollout

- Region capture repeatability benchmark (same site, multiple captures).
- Inter-device consistency analysis.
- Clinician agreement study on UV-derived features.
- Bias/performance checks across skin tones and lighting environments.

## Scope boundaries (current production)

- Current production uses RGB capture guidance and provider handoff support.
- CV outputs remain assistive (non-diagnostic) and clinician-reviewed.
- UV remains **R&D only** until hardware + validation milestones are complete.


---

<a id="vision-vision"></a>

## 🎯 Platform Vision: "Plaid for AI Agents"

*Former path: `docs/architecture/vision/VISION.md`*

## The Big Picture

**This is a middleware platform that enables AI agents to process payments.**

Think of it like **Plaid for AI Agents**:
- **Plaid** connects apps to banks → **We connect AI agents to payments
- **Plaid** supports multiple banks → **We support multiple agent platforms
- **Plaid** provides unified API → **We provide unified payment processing

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    AI AGENT PLATFORMS                        │
├─────────────────────────────────────────────────────────────┤
│  ChatGPT (ACP)  │  Google (AP2)  │  Voice (Retell/VAPI)    │
└────────┬───────────┬───────────────┬────────────────────────┘
         │           │               │
         ▼           ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│              MIDDLEWARE PLATFORM (This Project)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ACP Adapter  │  │ AP2 Adapter  │  │Voice Adapter │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                 │              │
│         └──────────────────┼─────────────────┘              │
│                            ▼                                │
│              ┌─────────────────────────┐                   │
│              │  Payment Orchestrator    │                   │
│              │  (Universal Format)      │                   │
│              └─────────────┬───────────┘                   │
│                            ▼                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Stripe     │  │   Circle     │  │  Mastercard  │      │
│  │              │  │   (USDC)     │  │  Agent Pay   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  Visa Agent  │  │  Link-Based  │                        │
│  │   Toolkit    │  │   Payment    │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    MERCHANTS / PROVIDERS                     │
│  (Healthcare, E-commerce, Services, etc.)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Core Goals

### 1. **Connect All AI Agent Platforms** ✅ (Partially Complete)

**Goal**: Enable any AI agent to process payments through a unified interface.

**Current Status**:
- ✅ **ACP (ChatGPT)**: Fully integrated via `acp-adapter.js`
- ✅ **AP2 (Google)**: Fully integrated via `ap2-adapter.js`
- ✅ **Voice (Retell/VAPI)**: Fully integrated via `voice-adapter.js`
- ✅ **Universal**: Fallback adapter for other platforms

**How It Works**:
- Each adapter converts platform-specific format → Universal `PaymentRequest` format
- Payment Orchestrator processes all requests the same way
- Response is converted back to platform-specific format

---

### 2. **Support All Payment Methods** 🔄 (In Progress)

**Goal**: Give merchants flexibility to accept payments via any method.

**Current Status**:

#### ✅ **Circle USDC** (Fully Implemented)
- **Purpose**: Insurance claim payments
- **Flow**: Insurer → Provider (USDC transfer)
- **Status**: Complete with wallet management, transfers, webhooks

#### ✅ **Link-Based Payment** (Working)
- **Purpose**: Email verification → Payment page
- **Flow**: Checkout → Email code → Verify → Stripe payment page
- **Status**: Production ready

#### 🔄 **Direct Stripe** (Partially Implemented)
- **Purpose**: Direct payment processing without email step
- **Flow**: Payment Intent → Client Secret → Frontend confirmation
- **Status**: Code exists, needs testing

#### ❌ **Mastercard Agent Pay** (TODO)
- **Purpose**: Voice commerce via Mastercard protocol
- **Flow**: Mandate verification → Payment authorization → Processing
- **Status**: Service file exists, needs integration

#### ❌ **Visa Agent Toolkit** (TODO)
- **Purpose**: Voice commerce via Visa protocol
- **Flow**: Mandate verification → Payment authorization → Processing
- **Status**: Service file exists, needs integration

---

### 3. **Provide Security & Fraud Detection** ✅ (Complete)

**Goal**: Protect merchants and customers from fraud.

**Current Status**:
- ✅ Rate limiting (API, auth, payment, voice endpoints)
- ✅ Security headers (Helmet.js)
- ✅ Input sanitization
- ✅ Request logging
- ✅ Webhook signature verification (Circle)
- ✅ Fraud detection service (risk scoring, blacklist/whitelist)

---

### 4. **Enable Healthcare-Specific Features** ✅ (Complete)

**Goal**: Support healthcare use cases (appointments, insurance, EHR).

**Current Status**:
- ✅ FHIR R4 patient records
- ✅ Insurance verification (Stedi API integration ready)
- ✅ Medical coding (ICD-10, CPT)
- ✅ EHR integration (Epic, 1upHealth)
- ✅ Appointment management
- ✅ Circle USDC for insurance claims

---

## 🚀 The Vision: What Success Looks Like

### For Merchants:
1. **One Integration**: Connect once, accept payments from any AI agent
2. **Multiple Payment Methods**: Choose Stripe, Circle, Mastercard, Visa, or all
3. **Fraud Protection**: Built-in security and fraud detection
4. **Healthcare Ready**: FHIR, insurance, EHR integration out of the box

### For AI Agent Platforms:
1. **Universal API**: One format works for all payment methods
2. **Flexible Routing**: Platform chooses best payment method
3. **Security**: Built-in fraud detection and verification
4. **Compliance**: HIPAA-ready for healthcare use cases

### For End Users:
1. **Seamless Experience**: Pay through voice, chat, or web
2. **Multiple Options**: Card, USDC, or other methods
3. **Secure**: All transactions protected by fraud detection
4. **Fast**: Direct processing when possible

---

## 📊 Current Implementation Status

### ✅ **Complete**
- [x] ACP adapter (ChatGPT)
- [x] AP2 adapter (Google)
- [x] Voice adapter (Retell/VAPI)
- [x] Universal adapter (fallback)
- [x] Payment Orchestrator (core routing)
- [x] Link-based payment (email verification flow)
- [x] Circle USDC (insurance claims)
- [x] Fraud detection service
- [x] Security middleware (rate limiting, headers, sanitization)
- [x] FHIR integration
- [x] Database schema

### 🔄 **In Progress**
- [ ] Direct Stripe payment (code exists, needs testing)
- [ ] Mastercard Agent Pay integration
- [ ] Visa Agent Toolkit integration
- [ ] API documentation (OpenAPI/Swagger)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Database backup automation

### ❌ **Not Started**
- [ ] Real Stedi API integration (needs API access)
- [ ] Azure email setup (needs Azure account)
- [ ] Additional payment methods (Apple Pay, Google Pay, etc.)

---

## 🎯 Answer to Your Question

> **"Is my goal to connect all payment systems?"**

**YES, but more specifically:**

1. **Connect all AI agent platforms** (ChatGPT, Google, Voice) → ✅ Done
2. **Support all payment methods** (Stripe, Circle, Mastercard, Visa) → 🔄 In Progress
3. **Provide unified interface** → ✅ Done (Payment Orchestrator)
4. **Add security & fraud protection** → ✅ Done
5. **Enable healthcare features** → ✅ Done

**The vision is**: Any AI agent can process payments through any payment method, all through one middleware platform.

---

## 🚦 Next Steps

Based on current status, priority should be:

1. **Complete payment method implementations** (Mastercard, Visa)
2. **Test and finalize Direct Stripe** integration
3. **Set up CI/CD** for automated testing
4. **Complete API documentation** for external developers
5. **Add database backup automation**

---

## 💡 Key Insight

**This is NOT just a payment processor.**

This is a **middleware platform** that:
- Translates between AI agent formats
- Routes to appropriate payment methods
- Provides security and fraud protection
- Enables healthcare-specific workflows
- Gives merchants one integration for all AI commerce

**Think of it as**: The "glue" that makes AI agents commerce-ready.



---

<a id="voice-agent-automated-retell-agent-creation"></a>

## Automated Retell Agent Creation

*Former path: `docs/architecture/voice-agent/AUTOMATED_RETELL_AGENT_CREATION.md`*

## Problem

Currently, creating a Retell agent requires:
1. Manual login to Retell dashboard
2. Manual agent creation
3. Manual configuration (prompt, functions, webhook)
4. Manual copying of agent ID

This doesn't scale for multi-tenant.

---

## Solution: Retell API for Agent Creation

Retell provides an API to create agents programmatically. We can automate this when a clinic signs up.

---

## Retell API Endpoints

### Create Agent
```
POST https://api.retellai.com/create-agent
```

### Update Agent
```
PATCH https://api.retellai.com/update-agent/{agent_id}
```

### Get Agent
```
GET https://api.retellai.com/get-agent/{agent_id}
```

---

## Automated Flow

### When Clinic Signs Up

1. **Clinic registers** on DocLittle
   - Provides: Name, phone number, etc.

2. **Backend automatically:**
   ```javascript
   // Step 1: Create Retell agent via API
   const agentResponse = await axios.post(
     'https://api.retellai.com/create-agent',
     {
       agent_name: `${clinicName} Voice Assistant`,
       llm_websocket_url: 'wss://doclittle.site/retell-llm',
       voice_id: '11labs-Adrian', // or clinic's preferred voice
       language: 'en-US',
       enable_transcription: true,
       enable_recording: true,
       // Use base prompt template, customize with clinic name
       system_prompt: generateClinicPrompt(clinicName, clinicInfo),
       // Same functions for all clinics
       functions: loadRetellFunctions()
     },
     {
       headers: {
         'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
         'Content-Type': 'application/json'
       }
     }
   );
   
   const agentId = agentResponse.data.agent_id;
   
   // Step 2: Store agent ID in database
   db.createClinic({
     clinic_id: clinicId,
     name: clinicName,
     retell_agent_id: agentId,  // Store the auto-created agent ID
     phone_number: phoneNumber,
     ...
   });
   ```

3. **Result:**
   - Agent created automatically
   - Agent ID stored in database
   - No manual steps required

---

## Prompt Template System

### Base Prompt Template

Create a template that gets customized per clinic:

```markdown
# Base Template (docs/voice-agent/base-prompt-template.md)

You are Kelly, the receptionist for {{CLINIC_NAME}}.

## About {{CLINIC_NAME}}
{{CLINIC_DESCRIPTION}}

## Business Hours
{{BUSINESS_HOURS}}

## Services Offered
{{SERVICES}}

## Contact Information
Phone: {{PHONE_NUMBER}}
Address: {{ADDRESS}}
```

### Customization Function

```javascript
function generateClinicPrompt(clinic) {
  const template = fs.readFileSync('docs/voice-agent/base-prompt-template.md', 'utf8');
  
  return template
    .replace(/{{CLINIC_NAME}}/g, clinic.name)
    .replace(/{{CLINIC_DESCRIPTION}}/g, clinic.description || 'a healthcare practice')
    .replace(/{{BUSINESS_HOURS}}/g, clinic.business_hours || 'Monday-Friday, 9 AM - 5 PM')
    .replace(/{{SERVICES}}/g, clinic.services || 'General healthcare services')
    .replace(/{{PHONE_NUMBER}}/g, clinic.phone_number)
    .replace(/{{ADDRESS}}/g, clinic.address || '');
}
```

---

## Complete Automated Setup Flow

### Clinic Signup Process

1. **Clinic fills signup form:**
   - Clinic name
   - Phone number
   - Business hours
   - Services
   - Address
   - etc.

2. **Backend processes signup:**
   ```javascript
   async function createClinic(clinicData) {
     // Step 1: Generate unique clinic ID
     const clinicId = `clinic-${uuidv4()}`;
     
     // Step 2: Create Retell agent automatically
     const agentId = await createRetellAgent(clinicData);
     
     // Step 3: Purchase/assign Twilio phone number
     const phoneNumber = await assignTwilioNumber(clinicId);
     
     // Step 4: Create clinic record
     db.createClinic({
       clinic_id: clinicId,
       name: clinicData.name,
       retell_agent_id: agentId,
       phone_number: phoneNumber,
       merchant_id: generateMerchantId(clinicId),
       ...
     });
     
     // Step 5: Link phone number to clinic
     db.createClinicPhoneNumber({
       phone_number: phoneNumber,
       clinic_id: clinicId
     });
     
     return { clinicId, agentId, phoneNumber };
   }
   ```

3. **Result:**
   - ✅ Retell agent created
   - ✅ Twilio number assigned
   - ✅ Database records created
   - ✅ Everything ready to use

---

## Retell API Implementation

### Create Agent Function

```javascript
async function createRetellAgent(clinicData) {
  const prompt = generateClinicPrompt(clinicData);
  const functions = loadRetellFunctions();
  
  try {
    const response = await axios.post(
      'https://api.retellai.com/create-agent',
      {
        agent_name: `${clinicData.name} Voice Assistant`,
        llm_websocket_url: process.env.RETELL_LLM_WEBSOCKET_URL || 'wss://doclittle.site/retell-llm',
        voice_id: clinicData.voice_id || '11labs-Adrian',
        language: 'en-US',
        enable_transcription: true,
        enable_recording: true,
        system_prompt: prompt,
        functions: functions,
        // Optional: clinic-specific settings
        response_delay: 400,
        interruption_threshold: 500,
        enable_backchannel: true
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.agent_id;
  } catch (error) {
    console.error('Failed to create Retell agent:', error);
    throw new Error('Failed to create voice agent');
  }
}
```

---

## Benefits of Automation

### Before (Manual)
- ❌ 15-20 minutes per clinic
- ❌ Human error risk
- ❌ Inconsistent configuration
- ❌ Can't scale

### After (Automated)
- ✅ 5 seconds per clinic
- ✅ Zero human error
- ✅ Consistent configuration
- ✅ Unlimited scale

---

## Error Handling

### What if Retell API fails?

```javascript
async function createClinic(clinicData) {
  try {
    const agentId = await createRetellAgent(clinicData);
    // Continue with clinic creation
  } catch (retellError) {
    // Option 1: Fail clinic creation (strict)
    throw new Error('Failed to create voice agent. Please try again.');
    
    // Option 2: Create clinic without agent, admin can add later
    console.warn('Retell agent creation failed, creating clinic without agent');
    // Continue with clinic creation, mark agent as pending
    db.createClinic({
      ...clinicData,
      retell_agent_id: null,
      retell_agent_status: 'pending'
    });
    
    // Queue for retry or manual creation
    queueAgentCreation(clinicData);
  }
}
```

---

## Updating Agents

### When Clinic Updates Info

If clinic changes name, hours, etc., update the agent:

```javascript
async function updateClinicAgent(clinicId, updates) {
  const clinic = db.getClinic(clinicId);
  const updatedPrompt = generateClinicPrompt({ ...clinic, ...updates });
  
  await axios.patch(
    `https://api.retellai.com/update-agent/${clinic.retell_agent_id}`,
    {
      system_prompt: updatedPrompt
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.RETELL_API_KEY}`
      }
    }
  );
}
```

---

## Summary

**Automated Agent Creation:**
1. Clinic signs up → Backend calls Retell API
2. Agent created with clinic-specific prompt
3. Agent ID stored in database
4. Zero manual steps

**Benefits:**
- Instant setup
- Consistent configuration
- Scalable to unlimited clinics
- No human error

**Implementation:**
- Use Retell API `create-agent` endpoint
- Template-based prompt generation
- Automatic error handling
- Update agents when clinic info changes



---

<a id="voice-agent-multi-model-reality-check"></a>

## Multi-Model Reality Check – Architecture & Cost Analysis

*Former path: `docs/architecture/voice-agent/MULTI_MODEL_REALITY_CHECK.md`*


## Executive Summary

**Critical Finding**: Multi-model routing affects only **2% of total cost** (PDF coding). The voice agent uses Retell's LLM, not ours.

**Impact on Priorities**:
- ❌ **Previous**: Multi-model = 60% cost savings (HIGH priority)
- ✅ **Reality**: Multi-model = accuracy optimization only (LOW priority, conditional)

**New Focus**: Optimize voice call efficiency (98% of cost) before considering multi-model.

---

## Architecture Reality

### Voice Call Path (No Our LLMs) ✅

```
Patient → Retell (their LLM + ASR + TTS) → Calls our tools → Return data
                    ↑
                    We don't control or pay for this LLM
                    Cost: Built into Retell's $0.02/min
```

**Our Tools (All Deterministic)**:

| Tool | Handler | Implementation | LLM? |
|------|---------|----------------|------|
| `assess_urgency` | `handleAssessUrgency()` | triage-service.detectRedFlags() (regex) | ❌ No |
| `search_icd10_codes` | `handleSearchIcd10Codes()` | knowledge-service.searchIcd10Codes() (DB) | ❌ No |
| `search_cpt_codes` | `handleSearchCptCodes()` | db.searchCptCodes() (DB) | ❌ No |
| `search_hcpcs_codes` | `handleSearchHcpcsCodes()` | knowledge-service.searchHcpcsCodes() (DB) | ❌ No |
| `validate_code_pair` | `handleValidateCodePair()` | knowledge-service.validateCodePair() (rules) | ❌ No |
| `check_payer_guidelines` | `handleCheckPayerGuidelines()` | fee-schedule-service (DB) | ❌ No |
| `get_code_pricing` | `handleGetCodePricing()` | fee-schedule-service (DB) | ❌ No |

**Key Insight**: All voice tools are DB lookups, regex patterns, or rule-based. **Zero LLM calls.**

---

### PDF Coding Path (Our LLMs) ✅

```
PDF → extract text → coding-orchestrator → route by complexity
                                              │
                        ┌─────────────────────┼────────────┐
                        │                     │            │
                    SIMPLE                MODERATE     COMPLEX
                        │                     │            │
                        ▼                     ▼            ▼
               simple-coding-rules   knowledge-service  Groq
               (no LLM) ✅           (no LLM) ✅     Llama-3.3-70B
               ~40% of PDFs          ~40% of PDFs    ~20% of PDFs
               $0/PDF                $0/PDF          $0.05-0.15/PDF
```

**Only COMPLEX PDFs hit Groq**: ~20% × 20 PDFs/day × $0.10 = **$2/day = $60/month**

---

## Cost Breakdown (1,000 calls/day)

| Component | Daily Cost | Monthly Cost | % of Total |
|-----------|------------|--------------|------------|
| **Retell (voice)** | $80 | $2,400 | 59% |
| **Twilio (voice)** | $52 | $1,560 | 39% |
| **Our Groq (PDF)** | $2 | $60 | 2% |
| **Total** | **$134** | **$4,020** | 100% |

**Voice calls**: 98% of cost  
**Our LLMs**: 2% of cost

---

## Cost Optimization Priority Order

```
Priority 1: Call Duration (25% savings = $990/month) 🔥
Priority 2: Call Deflection (20% savings = $780/month) 🔥
Priority 3: Retell Usage (10% savings = $390/month) 🟡
Priority 4: Multi-Model (0% savings, +accuracy) 🟢
```

---

## When Multi-Model Makes Sense

**Decision Criteria**:
- Evaluation shows accuracy <90% on expanded test suite, AND
- Failure analysis shows LLM reasoning would help, AND
- Rule-based fixes cannot address the gaps

**Key Principle**: Only add LLM calls when deterministic methods fail.

---

## Anti-Patterns to Avoid

❌ **Don't**: Implement multi-model before measuring need  
✅ **Do**: Evaluate first, implement only if gaps found

❌ **Don't**: Optimize the 2% (PDF coding cost)  
✅ **Do**: Optimize the 98% (voice call efficiency)

❌ **Don't**: Assume multi-model = cost savings  
✅ **Do**: Recognize multi-model = accuracy optimization (with added cost)

---

## Baseline Evaluation Status

- **Overall accuracy**: 100% (28/28 cases)
- **Triage accuracy**: 100%
- **Code retrieval**: 100%
- **Code-pair validation**: 100%

**Implication**: Multi-model not needed for accuracy on current test suite.

---

*See VOICE_AGENT_TODO_AND_STATUS.md for revised roadmap and RUNBOOK.md for cost optimization details.*


---

<a id="voice-agent-real-time-language-switching"></a>

## Real-Time Language Switching During Calls

*Former path: `docs/architecture/voice-agent/REAL_TIME_LANGUAGE_SWITCHING.md`*

## Your Scenario:
1. Agent starts in English
2. User says: "I don't speak English"
3. User says: "I can speak Russian"
4. Agent switches to Russian mid-call

---

## The Challenge: **Language vs Voice** 🔴

### **Two Separate Components:**

1. **LLM Response Language** (Text → Text)
   - The AI's response text language
   - Can switch dynamically
   - Controlled by system prompt and conversation context

2. **TTS Voice Language** (Text → Speech)
   - The voice synthesis language/accent
   - Set when agent is created (`language: 'en-US'`)
   - **This is harder to change mid-call**

---

## How It Would Work: **3 Possible Approaches**

### **Approach 1: LLM-Only Language Switching** (Easiest ✅)

**What happens:**

```
1. Agent created with: language: 'en-US', voice_id: '11labs-Adrian'

2. User calls, agent greets in English
   Agent: "Hello, I'm Kelly. How can I help you?"

3. User says: "I don't speak English. I speak Russian."

4. LLM (via WebSocket) processes this:
   - Detects language preference
   - Updates internal context
   - Starts responding in Russian text

5. Agent responds in Russian:
   Agent: "Привет! Я Келли. Чем могу помочь?" (in Russian text)

6. Retell TTS reads Russian text:
   - BUT: English voice (Adrian) tries to pronounce Russian
   - Result: Russian words with English accent (accented but understandable)
```

**Pros:**
- ✅ Works immediately (no code changes needed)
- ✅ LLM can switch languages dynamically
- ✅ Agent understands and responds correctly

**Cons:**
- ⚠️ Voice still uses English TTS (accented pronunciation)
- ⚠️ Might mispronounce Russian words
- ⚠️ Not ideal for clarity

**Feasibility:** ⭐⭐⭐⭐⭐ Very Easy - Already works!

---

### **Approach 2: Dynamic Agent Update** (Moderate ⚠️)

**What happens:**

```
1. Agent created with: language: 'en-US', voice_id: '11labs-Adrian'

2. User says: "I don't speak English. I speak Russian."

3. WebSocket handler detects language preference:
   - Analyzes transcript
   - Detects "Russian" mentioned
   - Triggers agent update

4. Call Retell API: updateAgent(agentId, {
     language: 'ru-RU',
     voice_id: '11labs-Ivan'  // Russian voice
   })

5. Agent configuration changes:
   - Language: en-US → ru-RU
   - Voice: Adrian → Ivan

6. Next agent response uses Russian voice
```

**Pros:**
- ✅ Proper Russian voice pronunciation
- ✅ Professional multilingual experience
- ✅ Clear communication

**Cons:**
- ⚠️ Takes 1-2 seconds to update (API call delay)
- ⚠️ Might interrupt conversation flow
- ⚠️ Need to check if Retell supports mid-call updates
- ⚠️ More complex implementation

**Feasibility:** ⭐⭐⭐ Moderate - Need to verify Retell supports this

---

### **Approach 3: Pre-configured Multilingual Agent** (Most Reliable 🎯)

**What happens:**

```
1. Agent created with MULTIPLE language support:
   language: 'en-US',  // Primary
   voice_id: '11labs-Adrian',  // Primary voice
   system_prompt: "You are Kelly. You speak English and Russian fluently..."

2. System prompt includes instructions:
   "If user indicates they don't speak English and mention another language,
    immediately switch to that language. Continue the conversation entirely
    in that language."

3. User says: "I don't speak English. I speak Russian."

4. LLM processes and switches context:
   - Responds in Russian text
   - Mentions language switch explicitly

5. BUT: Still uses English voice for TTS
   - Russian text with English accent
   - LLM responds: "Конечно! Я переключаюсь на русский язык..."
     (in Russian text, spoken with English voice)
```

**Pros:**
- ✅ Works reliably (no API updates needed)
- ✅ Fast (no delays)
- ✅ LLM handles language detection

**Cons:**
- ⚠️ Voice pronunciation still not perfect
- ⚠️ Can be improved with Approach 2

**Feasibility:** ⭐⭐⭐⭐⭐ Very Easy - Just prompt engineering

---

## **My Recommendation: Hybrid Approach** 🎯

### **Phase 1: Start with Approach 3** (Quick Win)

**Update system prompt:**
```
"You are Kelly, a multilingual medical assistant. 
You speak English and Russian fluently.

IMPORTANT LANGUAGE SWITCHING RULES:
- If a caller says they don't speak English or prefer another language, 
  immediately acknowledge and switch to that language.
- Continue the ENTIRE conversation in their preferred language.
- If they say 'I speak Russian' or 'Russian please', respond in Russian.
- Use professional medical terminology in their language.

Example:
User: "I don't speak English. I speak Russian."
You: "Конечно! Я Келли, ваш медицинский ассистент. Чем могу помочь?" 
     (Certainly! I'm Kelly, your medical assistant. How can I help you?)
```

**Result:**
- ✅ LLM responds in Russian immediately
- ✅ No code changes needed
- ✅ Works right away
- ⚠️ Voice uses English accent (understandable but not perfect)

### **Phase 2: Add Voice Switching** (If Needed)

**If accent is a problem:**
- Implement Approach 2 (dynamic agent update)
- Update voice_id when language preference detected
- Requires API call mid-call (slight delay)

---

## **Technical Flow (Approach 3 - Recommended)**

```
┌─────────────────────────────────────────────────┐
│  Call Starts (Agent in English)                │
│  language: 'en-US', voice_id: '11labs-Adrian'  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Agent: "Hello, I'm Kelly. How can I help?"    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  User: "I don't speak English. I speak Russian"│
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  WebSocket Handler receives transcript         │
│  - Detects language preference                 │
│  - Updates conversation context                │
│  - LLM processes: "User prefers Russian"       │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  LLM Response (Russian text):                  │
│  "Конечно! Я Келли. Чем могу помочь?"          │
│  (Certainly! I'm Kelly. How can I help you?)   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Retell TTS converts text to speech            │
│  - Reads Russian text                          │
│  - Uses English voice (Adrian)                 │
│  - Pronounces with English accent              │
│  - Understandable but accented                 │
└─────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Conversation continues in Russian              │
│  - LLM responds in Russian                     │
│  - TTS uses English voice                      │
│  - Both parties understand each other          │
└─────────────────────────────────────────────────┘
```

---

## **What You Need:**

### **1. Updated System Prompt** (5 minutes)
Add language switching instructions to prompt template.

### **2. Language Detection Logic** (Optional - 1 hour)
In WebSocket handler:
- Monitor transcript for language preferences
- Store detected language in connection object
- Could enhance with Azure Text Analytics language detection

### **3. Dynamic Agent Update** (Optional - 4-6 hours)
If you want perfect voice pronunciation:
- Detect language preference
- Call `updateAgent()` API
- Update `voice_id` to Russian voice
- Continue conversation with Russian voice

---

## **Complexity Rating:**

### **Approach 3 (LLM-Only):** ⭐ Easy
- **Time:** 30 minutes (just prompt update)
- **Risk:** Low
- **Result:** Russian responses with English accent

### **Approach 2 (Dynamic Update):** ⭐⭐⭐ Moderate
- **Time:** 4-6 hours
- **Risk:** Medium (need to verify Retell supports mid-call updates)
- **Result:** Perfect Russian voice

### **Approach 1 + 2 (Hybrid):** ⭐⭐ Easy-Moderate
- **Time:** 30 min + 4-6 hours (if needed)
- **Risk:** Low (can start with Approach 1, add 2 later)
- **Result:** Works immediately, can improve later

---

## **Answer to Your Question:**

**"I tell the agent I don't speak English and tell it I can speak Russian, and we speak Russian"**

### **How it works (Approach 3 - Easiest):**

1. **You say:** "I don't speak English. I speak Russian."

2. **LLM detects:** Language preference = Russian

3. **LLM responds in Russian:**
   - Text response: "Конечно! Я переключаюсь на русский язык. Как я могу помочь?"
   - (Certainly! I'm switching to Russian. How can I help you?)

4. **TTS speaks:**
   - English voice reads Russian text
   - Accented but understandable

5. **Conversation continues:**
   - You speak Russian
   - Agent responds in Russian (text)
   - TTS uses English voice (accented Russian)

### **To get perfect Russian voice:**

1. System detects Russian preference
2. Calls Retell API: `updateAgent()` with `voice_id: '11labs-Ivan'`
3. Next response uses Russian voice
4. Clear Russian pronunciation

---

## **Bottom Line:**

**Easiest way (works immediately):**
- Update system prompt to detect language preferences
- LLM switches to Russian automatically
- Voice uses English accent (understandable)

**Best way (requires implementation):**
- Detect language preference
- Update agent mid-call with Russian voice
- Perfect Russian pronunciation

**Start with easiest, upgrade if needed!**



---

<a id="voice-agent-runbook"></a>

## Medical Coding Voice Agent – Runbook

*Former path: `docs/architecture/voice-agent/RUNBOOK.md`*

Operational procedures for the medical coding voice agent.

---

## 1. Run ICD-10 / CPT / HCPCS Imports

All imports run from `middleware-platform/`:

```bash
cd middleware-platform
```

### ICD-10 (~72K codes)

**Source:** `Knowledge/ICD-10 Files/2020 Code Descriptions/icd10cm_codes_2020.txt`

```bash
node scripts/import-icd10-codes.js
```

### CPT (DHS addendum, ~1.3K codes)

**Source:** `Knowledge/CPT/2025_DHS_Code_List_Addendum_11_26_2024.xlsx`

```bash
node scripts/import-cpt-codes.js
```

*Note:* DHS addendum omits common E/M codes (99213, 99214). Use full CPT when available.

### HCPCS (~9K codes)

**Source:** `Knowledge/HCPCS/hcpc2026_jan_anweb_01122026/HCPC2026_JAN_ANWEB_01122026.txt`

```bash
node scripts/import-hcpcs-codes.js
```

### Semantic embeddings (optional)

Requires `OPENAI_API_KEY` in `.env`. Run after ICD-10/CPT/HCPCS imports:

```bash
node scripts/populate-code-embeddings.js [--limit N] [--type icd10|cpt|hcpcs]
```

---

## 2. Run Evaluation Suite

```bash
cd middleware-platform
node tests/medical-coding/evaluate-accuracy.js
```

Voice agent flow evaluation (extraction, triage, code retrieval):

```bash
node tests/medical-coding/evaluate-voice-agent.js
```

With LLM hallucination check (requires `GROQ_API_KEY`):

```bash
node tests/medical-coding/evaluate-accuracy.js --llm
```

With test database:

```bash
NODE_ENV=test node tests/medical-coding/evaluate-accuracy.js
```

Test cases: `tests/medical-coding/test-cases.json` (28 cases), `tests/medical-coding/voice-agent-test-cases.json` (6 voice flow cases).  
See `tests/medical-coding/README.md` for metrics and baseline.

---

## 3. Add New Coding Rules

### Code-pair validation (incompatible ICD-10 + CPT)

Edit `Knowledge/rules/code-pair-validation.json`:

```json
{
  "incompatible_pairs": [
    {
      "rule_id": "your_rule_id",
      "icd10_pattern": "^Z00",
      "cpt_pattern": "^99285",
      "reason": "Human-readable reason"
    }
  ]
}
```

- Patterns are regex; codes matched with or without dots (e.g. `Z00.129` or `Z00129`).
- Rules cached 30 days. After editing: restart or `POST /api/admin/cache/clear?bucket=coding_rules`.

### Simple coding rules (rule-based mapping)

Edit `Knowledge/rules/simple-coding-rules.json`. Format:

```json
{
  "match": { "appointment_type": "...", "diagnosis_keywords": ["..."] },
  "icd10": ["E11.9"],
  "cpt": ["99213"],
  "rationale": "Type 2 diabetes follow-up"
}
```

---

## 4. Cleanup & Retention

Voice call state data (including `coding_decisions`) is retained 30 days by default:

```bash
node scripts/cleanup-voice-call-state.js [days]
```

Example: 7-day retention:

```bash
node scripts/cleanup-voice-call-state.js 7
```

---

## 5. Medical Coding Tools (Retell)

Full schemas: `docs/architecture/README.md#voice-agent-tool-schemas`

| Tool | Purpose |
|------|---------|
| `search_icd10_codes` | Look up ICD-10 by symptom/condition |
| `search_cpt_codes` | Look up CPT by procedure |
| `search_hcpcs_codes` | Look up HCPCS (DME, supplies, modifiers) |
| `suggest_codes_from_symptoms` | Get ICD-10 + CPT from patient description; returns validated_pairs |
| `extract_medical_text` | Extract { symptoms, vitals, severity, temporal } from utterance |
| `assess_urgency` | Triage: EMERGENT / URGENT / ROUTINE (rule-based) |
| `validate_code_pair` | Check ICD-10 + CPT compatibility |
| `check_payer_guidelines` | Check if payer has fee schedule |
| `get_code_pricing` | Get allowed amounts for CPT codes |

---

## 6. Caching (Phase 3.3)

In-memory cache for code lookups and payer data. TTLs: code lookups 24h, payer guidelines 7d, coding rules 30d.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/cache-stats` | Hit/miss counts, hit rate, cache size |
| `POST /api/admin/cache/clear?bucket=` | Clear cache. `bucket` optional: `code_lookup`, `payer_guidelines`, `payer_pricing`, `coding_rules`, `slot_availability` |

After bulk fee schedule upload or rule edits, clear the relevant bucket.

---

## 6.1 Latency Budgets (Phase 8.1)

| Stage | Max latency | P95 target |
|-------|-------------|------------|
| Triage (assess_urgency) | 500ms | 300ms |
| Code search (ICD-10/CPT/HCPCS) | 1s | 500ms |
| Code-pair validation | 200ms | 100ms |
| Full getCodeCandidates | 2s | 1.5s |

Env: `MIN_CODING_CONFIDENCE=0.7` (Phase 6.4) – suggestions below threshold route to manual review.

---

## 6.2 LangSmith Observability (Phase 8.2)

Medical coding Groq calls are traced to LangSmith when configured:

| Env Var | Purpose |
|---------|---------|
| `LANGSMITH_API_KEY` | LangSmith API key for tracing |
| `AP_Langchain` | Fallback for `LANGSMITH_API_KEY` (legacy) |
| `LANGCHAIN_TRACING_V2` | Set to `true` to enable (default when key present) |

Set in `.env`:
```
LANGSMITH_API_KEY=lsv2_pt_...
# or AP_Langchain=lsv2_pt_...
```

`llm_usage_log` tracks: operation, model, tokens_in, tokens_out, cost_usd, latency_ms, confidence_score.

`GET /api/admin/metrics?days=7` returns LLM aggregates and confidence distribution.

---

## 6.4 Medical Coding Voice Agent Prompt & Configure Retell

Append `docs/voice-agent/medical-voice-agent-prompt.md` to your Retell agent system prompt (Kelly) to enable the medical coding workflow: EXTRACT → TRIAGE → CODE → PRICE → VALIDATE.

**Configure Retell** (push prompt + functions to Retell):

```bash
cd middleware-platform
node configure-retell.js
```

Requires: server running on port 4000 (or `API_BASE_URL` in .env for production), `RETELL_API_KEY`, `RETELL_AGENT_ID` in `.env`. Script loads Kelly prompt from `docs/voice-agent/prompts/kelly-voice-agent-prompt.md`, appends `medical-voice-agent-prompt.md`, and updates the Retell agent with the combined prompt and function definitions.

---

## 7. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| **"attempt to write a readonly database"** | Sandbox or DB path outside workspace | Run with full permissions; ensure DB dir is writable |
| **ICD-10 search returns few/empty results** | Using JSON fallback (271 codes) instead of DB | Run `import-icd10-codes.js`; verify `icd10_codes` table has ~72K rows |
| **CPT 99213 not found** | DHS addendum lacks common E/M codes | Expected; add full CPT source or relax test expectations |
| **Evaluation failures on code retrieval** | Missing phrase in `MEDICAL_PHRASES` or `PHRASE_EXPANSIONS` | Add phrase in `knowledge-service.js`; add expansion if DB description differs |
| **validate_code_pair always valid** | Rules file missing or invalid | Check `Knowledge/rules/code-pair-validation.json` exists and is valid JSON |
| **Stale data after rule/fee update** | Cache not invalidated | `POST /api/admin/cache/clear?bucket=coding_rules` or `payer_guidelines` |
| **Costs not updating** | Twilio/Retell API keys or call end webhook | Verify `fetchCallCosts` in `utils/cost-tracker.js`; check call end flow |

### Verify fee schedule

```bash
node -e "
const db = require('./database');
const rows = db.getFeeSchedulesByPayer?.('BCBS', 5) || [];
console.log('Fee schedules for BCBS:', rows.length);
"
```

### Verify DB counts

```bash
cd middleware-platform
node -e "
const db = require('./database');
console.log('ICD-10:', db.getIcd10CodesCount?.() ?? 'N/A');
console.log('CPT:', db.db?.prepare('SELECT COUNT(*) as n FROM cpt_codes').get()?.n ?? 'N/A');
console.log('HCPCS:', db.getHcpcsCodesCount?.() ?? 'N/A');
"
```

---

## 8. Cost Optimization Priority

Voice calls (Retell + Twilio) = 98% of cost. Our LLMs (PDF coding) = 2%.

| Priority | Focus | Savings |
|----------|-------|---------|
| 🔥 1 | Call duration (4→3 min) | ~$990/mo |
| 🔥 2 | Call deflection (20%) | ~$780/mo |
| 🟡 3 | Retell usage optimization | ~$390/mo |
| 🟢 4 | Multi-model | -$30/mo (accuracy only) |

### SMS Booking (Call Deflection P2)

Configure Twilio Phone Number SMS webhook to: `https://yoursite.com/sms/incoming`

Supported: BOOK, CANCEL, HOURS, HELP. Booking flow: pick date → pick slot → confirm.

See `docs/architecture/README.md#voice-agent-multi-model-reality-check` for full analysis.


---

<a id="voice-agent-state-flow"></a>

## Medical Coding Voice Agent – State Flow

*Former path: `docs/architecture/voice-agent/STATE_FLOW.md`*


State machine for the medical coding voice agent. Implemented in `coding-state-service.js`, persisted via `retell-websocket.js`.

## Stages

| Stage | Description |
|-------|-------------|
| INTAKE | Call start; collecting patient info, scheduling |
| EXTRACTION | User described symptoms; extracting entities |
| TRIAGE | Assessing urgency (EMERGENT/URGENT/ROUTINE) |
| CODING | Searching ICD-10/CPT/HCPCS |
| VALIDATION | Validating code pairs, checking guidelines |
| BILLING | Insurance, pricing, checkout |

## Transitions

- **First user utterance**: INTAKE → EXTRACTION
- **assess_urgency**: → TRIAGE
- **search_icd10_codes / search_cpt_codes / search_hcpcs_codes**: → CODING (then auto → VALIDATION after completion)
- **validate_code_pair**: → VALIDATION
- **collect_insurance / get_code_pricing**: → BILLING
- **schedule_appointment, get_available_slots, etc.**: stay in INTAKE

Stages only advance forward (or to BILLING); no backwards transitions.

## Persistence

- **voice_call_states**: current_stage, state_data per call
- **voice_conversation_memory**: turn_number, role, content per turn
- **agent_state_snapshots**: stage transition snapshots for audit

## Cleanup

```bash
node scripts/cleanup-voice-call-state.js [days]
```

Default: 30 days retention.

## Monitoring

| Source | Data |
|--------|------|
| **function_call_log** | function_name, response_time_ms, success, call_id |
| **voice_call_log** | twilio_cost_usd, retell_cost_usd, total_cost_usd, call_duration_minutes |
| **coding_decisions** | proposed_icd10, proposed_cpt, validation_status per validate_code_pair |
| **agent_state_snapshots** | stage transitions, function results |

Costs fetched from Twilio/Retell APIs on call end; fallback to calculated estimates.


---

<a id="voice-agent-tool-schemas"></a>

## Medical Coding Voice Agent – Tool Schemas & Usage

*Former path: `docs/architecture/voice-agent/TOOL_SCHEMAS.md`*


Reference for Retell function calls used during medical coding voice conversations.

---

## Medical Coding Tools

### search_icd10_codes

Look up ICD-10 diagnosis codes by symptom, condition, or code prefix.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Symptom, condition name, or ICD-10 code (e.g. "diabetes", "E11.9") |
| `limit` | number | No | Max results (default 10) |

**When to call**: Caller mentions a diagnosis or symptom; need codes for billing.

**Returns**: `{ code, description, category }[]`

---

### search_cpt_codes

Look up CPT procedure codes by procedure name or code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Procedure name or CPT code (e.g. "office visit", "99213") |
| `limit` | number | No | Max results (default 10) |

**When to call**: Caller mentions a service/procedure; need codes for billing.

**Returns**: `{ code, description, category, subcategory }[]`

---

### search_hcpcs_codes

Look up HCPCS Level II (supplies, DME, drugs, modifiers).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Procedure, supply, modifier, or HCPCS code (e.g. "wheelchair", "E0601") |
| `limit` | number | No | Max results (default 10) |

**When to call**: DME, supplies, injectable drugs, modifiers not in CPT.

**Returns**: `{ code, description, short_desc, type }[]`

---

### suggest_codes_from_symptoms

Get suggested ICD-10 and CPT codes from patient's description of symptoms or reason for visit. Returns top codes with patient-friendly descriptions and pre-validated ICD-10+CPT pairs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `clinical_text` | string | Yes | Patient description (e.g. "type 2 diabetes follow-up", "anxiety and depression") |
| `max_icd10` | number | No | Max ICD-10 codes (default 5) |
| `max_cpt` | number | No | Max CPT codes (default 5) |

**When to call**: Patient describes condition; need codes for billing.

**Returns**: `{ icd10: [{ code, description, patient_friendly }], cpt: [...], validated_pairs: [{ icd10_code, cpt_code, valid, reason }] }`

---

### extract_medical_text

Extract structured medical data from patient utterance: symptoms, vitals, severity, temporal info.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patient_utterance` | string | Yes | Patient's spoken description of symptoms |

**When to call**: Patient describes symptoms; need structured data for triage or coding.

**Returns**: `{ symptoms: string[], vitals: { temperature?, systolic?, diastolic?, heart_rate? }, severity: string|null, temporal: { duration_days?, acuteness?, ... } }`

---

### assess_urgency

Triage patient symptoms: EMERGENT, URGENT, or ROUTINE.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symptoms_text` | string | Yes | Patient description of symptoms |

**When to call**: Before scheduling or coding; caller describes symptoms.

**Returns**: `{ urgency: "EMERGENT"|"URGENT"|"ROUTINE", isEmergency, suggestedResponse }`

---

### validate_code_pair

Check ICD-10 + CPT compatibility for billing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `icd10_code` | string | Yes | ICD-10 code (e.g. "E11.9") |
| `cpt_code` | string | Yes | CPT code (e.g. "99213") |

**When to call**: Before finalizing coding suggestions.

**Returns**: `{ valid: boolean, reason?: string }`

---

### check_payer_guidelines

Check if payer has fee schedule/guidelines.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payer_id` | string | Yes | Payer ID (BCBS, AETNA, UHC) |
| `payer_name` | string | No | Payer name if payer_id unknown |

**When to call**: Before quoting prices; caller asks about insurance coverage.

**Returns**: `{ hasFeeSchedule: boolean }`

---

### get_code_pricing

Get allowed amounts for CPT codes from payer fee schedule.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payer_id` | string | Yes | Payer ID |
| `cpt_codes` | string[] | Yes | CPT codes (e.g. ["99213","99214"]) |
| `date_of_service` | string | No | YYYY-MM-DD |

**When to call**: Caller asks about pricing or patient responsibility.

**Returns**: `{ [cptCode]: allowedAmount }`

---

## Suggested Workflow

1. **assess_urgency** → If EMERGENT, advise 911; do not schedule.
2. **suggest_codes_from_symptoms** (preferred) or **search_icd10_codes** + **search_cpt_codes** → Get candidates. Use `validated_pairs` from suggest when presenting.
3. **validate_code_pair** → Only when combining codes from separate searches; `suggest_codes_from_symptoms` returns pre-validated pairs.
4. **check_payer_guidelines** → If caller has insurance and needs pricing.
5. **get_code_pricing** → For allowed amounts per code. Offer after suggesting codes: "Would you like me to check your insurance for the copay?"

---

*Source: retell-functions.json. See RUNBOOK.md for operational details.*


---

<a id="voice-agent-voice-agent-todo-and-status"></a>

## Voice Agent — Todo & Implementation Status

*Former path: `docs/architecture/voice-agent/VOICE_AGENT_TODO_AND_STATUS.md`*

**Last Updated:** April 6, 2026

Merged from: MEDICAL_CODING_AGENT_TODO, AI_AGENT_FINANCIAL_LAYER_TODO, IMPLEMENTATION_STATUS.

---

## 1. Implementation Status Summary

**Overall Maturity:** ~85% complete

| Layer | Completeness | Status |
|-------|--------------|--------|
| Infrastructure (DB, imports, search) | 100% | ✅ Production ready |
| State Management (LangGraph-style) | 100% | ✅ Production ready |
| Context Assembly (RAG) | 100% | ✅ Production ready |
| Safety (red flags, validation) | 80% | 🟡 Missing confidence thresholds |
| Tools (Retell functions) | 100% | ✅ All tools + caching |
| Memory & Audit | 100% | ✅ coding_decisions, snapshots |
| Evaluation | 80% | ✅ Framework + baseline; expand cases |
| Multi-Model | 0% | 🟢 Low priority |
| Monitoring | 90% | ✅ llm_usage_log, LangSmith |

---

## 2. Fully Implemented

- **State:** voice_call_states, voice_conversation_memory, agent_state_snapshots
- **RAG:** getCodeCandidates, context-assembler, ICD-10/CPT/HCPCS search
- **Tools:** search_icd10_codes, search_cpt_codes, search_hcpcs_codes, suggest_codes_from_symptoms, extract_medical_text, validate_code_pair, assess_urgency, check_payer_guidelines, get_code_pricing
- **Safety:** detectRedFlags, code existence validation, code-pair validation, emergency blocking
- **Financial:** triage-rules.json, medical abbreviations, FeeScheduleService (payerId in options)
- **Evaluation:** test-cases.json (~28), voice-agent-test-cases.json (6), evaluate-accuracy.js, evaluate-voice-agent.js
- **Caching:** in-memory (24h/7d/30d), cache-service, /api/admin/cache-stats

---

## 3. Pending / Partially Done

| Task | Status | Notes |
|------|--------|-------|
| Semantic search (OPENAI) | ❌ | embedText, hybridSearch exist; needs OPENAI_API_KEY + populated embeddings |
| Confidence thresholds | ⚠️ | MIN_CODING_CONFIDENCE=0.7; reject low-confidence suggestions |
| Expand test cases to 100+ | ❌ | Broader coverage |
| Latency budgets, P95 alerts | ❌ | Per-stage budgets |
| Multi-model router | ❌ | LOW – affects ~2% cost (PDF only); see MULTI_MODEL_REALITY_CHECK |
| CDT Dental | ❌ | Lower priority |

---

## 4. Cost Optimization Priority

| Priority | Focus | Savings |
|----------|-------|---------|
| 🔥 1 | Call duration (4→3 min) | ~$990/mo |
| 🔥 2 | Call deflection (20%) | ~$780/mo |
| 🟡 3 | Retell usage optimization | ~$390/mo |
| 🟢 4 | Multi-model | -$30/mo (only if accuracy gaps) |

---

## 5. Critical Order (Completed)

1. Phase 0 ✅ — Paths, CPT import, wire KB to voice
2. Phase 1 ✅ — State management
3. Phase 2 ✅ — ICD-10/HCPCS, RAG
4. Phase 3 ✅ — Tools, caching
5. Phase 5 ✅ — Memory, coding_decisions
6. Phase 6 ✅ — Safety, validation
7. Phase 7 ✅ — Evaluation framework

---

## 6. Related Docs

- [RUNBOOK.md](./RUNBOOK.md) — Imports, evaluation, troubleshooting
- [TOOL_SCHEMAS.md](./TOOL_SCHEMAS.md) — Tool definitions
- [MULTI_MODEL_REALITY_CHECK.md](./MULTI_MODEL_REALITY_CHECK.md) — Cost analysis


