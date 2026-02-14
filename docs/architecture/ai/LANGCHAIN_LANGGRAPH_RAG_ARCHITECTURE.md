# LangChain, LangGraph & RAG — Implementation Architecture

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
