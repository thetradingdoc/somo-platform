# Middleware Brain Improvements: Code Changes & Impact

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
- [x] **Data retention policy (Section 21)** — `config/retention-policy.js`; `docs/compliance/DATA_RETENTION_POLICY.md`; `scripts/cleanup-retention.js`
- [x] **Latency budget constants (Section 3)** — `config/latency-budget.js`; per-function budgets; violations in `/api/admin/metrics`
- [x] **Tool handler unit tests (Section 4)** — `tests/tool-handlers/validate-code-pair.test.js`, `suggest-codes.test.js`
- [x] **Cache warming (Section 24)** — `cache-service.warm()`; called on server startup
- [x] **DLQ for tool calls (Section 2)** — `dlq_tool_calls` table; `enqueueToolCallDLQ` on handleFunctionCall failure; `tool-call-dlq-worker.js`; `dlq_tool_calls` in `/api/admin/metrics`; `GET /api/admin/dlq-tool-calls`
- [x] **Graceful Tiba degradation (Section 2)** — `settled: false, manualReview: true` when Stedi fails in `checkEligibility` and `submitClaim`; `stediFallback: true` flag
- [x] **GET /api/admin/dashboards/calls (Section 1)** — Call volume, state transitions, tool usage, error rates over last N days
- [x] **State transitions test (Section 4)** — `tests/state-transitions.test.js` for `computeNextStage`
- [x] **Accuracy evaluation (Section 4)** — `scripts/evaluate-accuracy.js`; voice-agent-test-cases; `npm run test:accuracy`; CI step with `ACCURACY_THRESHOLD`
- [x] **DR runbook enhancements (Section 18)** — RTO/RPO verification; quarterly restore test procedure in `docs/runbooks/DR.md`
- [x] **Alert rules config (Section 20)** — `docs/runbooks/ALERT_RULES.md`; Azure Monitor rule definitions; alert → runbook mapping
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
| Document in MEDIA_LAYER_ARCHITECTURE | `docs/architecture/media/MEDIA_LAYER_ARCHITECTURE.md` | Add LiveKit Agent flow: audio → middleware → tools → TTS → room |

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
| Create `docs/runbooks/DR.md` | New file | Steps to restore from backup; RTO/RPO targets; contact escalation |
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
| Add runbook links to alerts | Alert metadata | "Stedi down? See docs/runbooks/STEDI_DOWN.md" |

### 20.1 Alert → Runbook Mapping

| Alert | Threshold | Runbook |
|-------|-----------|---------|
| Stedi circuit open | >5 min | `docs/runbooks/STEDI_DOWN.md` |
| Groq rate limit | 5 consecutive 429s | `docs/runbooks/GROQ_RATE_LIMIT.md` |
| Low confidence spike | >10% rejected | `docs/runbooks/LOW_CONFIDENCE_SPIKE.md` |
| Postgres sync queue depth | >100 pending | `docs/runbooks/POSTGRES_SYNC_BACKLOG.md` |
| Error rate spike | >5% | `docs/runbooks/ERROR_RATE_SPIKE.md` |

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
- **DR plan:** Active-passive or active-active? Document in `docs/runbooks/DR.md`
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
