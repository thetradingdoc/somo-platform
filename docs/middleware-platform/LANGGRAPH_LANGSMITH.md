# LangGraph & LangSmith — Developer Guide

**Last Updated:** February 2026

Single reference: config, what’s traced, how to see progress, scripts, and troubleshooting.

---

## 1. Configuration (what sends data)

Tracing is enabled when **`LANGSMITH_API_KEY`** (or **`AP_Langchain`**) is set and **`LANGCHAIN_TRACING_V2`** ≠ `'false'`. **Project:** `LANGCHAIN_PROJECT` / `LANGSMITH_PROJECT` (default `middleware-{env}`). `server.js` loads `utils/langsmith-config.js` first so all LangChain/LangGraph usage is traced.

---

## 2. What is traced

Only **LangChain/LangGraph** calls are sent. Raw HTTP/DB is not traced unless wrapped.

| Component | File | Traced | When |
|-----------|------|--------|------|
| Voice coding (LangGraph) | `coding-graph.js` | Full graph (INTAKE → … → BILLING), checkpointer | Retell when LangGraph enabled |
| Voice coding (LLM) | `medical-coding-service.js` | ChatGroq; tags `medical-coding`, `clinic:{id}`, `call:{id}` | ICD-10/CPT suggestion |
| **Video consult (LangGraph)** | `video-consult-graph.js` | Full graph (accumulate → retrieve_context → human_review → store_fhir); run name `video_consult_{eventType}`; tags `video-consult`, roomId. **Node output:** `processing_metadata` with `remote_count`, `local_count`, `merged_count` | Each agent event; pipeline on end_session |
| Perception | `perception-layer/perception-graph.js` | Graph + GPT-4o text node | Layer1 diagnostic scripts |
| Chat / Admin AI | `chat-llm-service.js`, `admin-ai-assistant-service.js` | ChatGroq | Chat / admin AI |
| Semantic search | `semantic-search-service.js` | OpenAIEmbeddings | Semantic code search |

**Not traced:** RAG HTTP (`remote-rag-client.js`), knowledge-service DB, FHIR writes, REST routes, LiveKit Python agents (unless they trace separately).

---

## 3. How to see progress in LangSmith

1. Open https://smith.langchain.com → select project (e.g. **Doctor Little**).
2. **Runs:** Filter by tags (`video-consult`, `medical-coding`), run name (`video_consult_end_session`), time.
3. Open a run: top-level = `invoke()`; child spans = graph nodes. For video consult: node order + output state (`current_stage`, `rag_context`, `processing_metadata.merged_count`) show progress.
4. No live streaming; use your APIs for real-time UI; LangSmith for post-hoc inspection.

**Quick check:** `cd middleware-platform && npm run test:langsmith`

---

## 4. Environment variables

```bash
# LangSmith (production: required or degraded health)
LANGSMITH_API_KEY=lsv2_pt_...   # or AP_Langchain
LANGCHAIN_TRACING_V2=true
LANGSMITH_MANDATORY=true        # optional: fail startup if missing

# LangGraph (voice)
LANGGRAPH_ROLLOUT_PCT=1
LANGGRAPH_SHADOW=true
LANGGRAPH_ENABLED=true
POSTGRES_URL=postgresql://...
LANGGRAPH_USE_POSTGRES=true
LANGGRAPH_CHECKPOINT_SCHEMA=public
```

---

## 5. Scripts

| Command | Purpose |
|---------|---------|
| `npm run test:langsmith` | Send test trace to LangSmith (requires network) |
| `npm run test:langgraph` | Transcript + function_call through coding graph (shadow) |
| `npm run reconcile:langgraph` | Detect divergence Postgres checkpoints vs voice_call_states; `--repair` to seed |
| `npm run migrate:langgraph` | Seed Postgres checkpointer from voice_call_states; `--dry-run`, `--limit=N` |

---

## 6. LangGraph state (voice)

**States:** INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING. `processTurn(db, callId, triggerType, triggerPayload)`. Checkpointer: MemorySaver (dev) or PostgresSaver (prod).

---

## 7. Tags, metadata, human review

**Medical coding:** Tags `medical-coding`, `doctor-little`, `suggest_codes`, `clinic:{id}`, `call:{id}`; metadata `clinic_id`, `call_id`, `operation`. **LangSmith UI:** Evaluators, Feedback on runs, Datasets. **Code-level HITL:** `LANGGRAPH_HUMAN_REVIEW=true` (interrupt before BILLING).

---

## 8. Feature flags

`langgraph_enabled`: `config/feature-flags.js`, DB `feature_flags`, `utils/feature-flags.js` → `isEnabled('langgraph_enabled', clinicId, callId)`.

---

## 9. Troubleshooting

| Issue | Action |
|-------|--------|
| No traces | `LANGSMITH_API_KEY`, `LANGCHAIN_TRACING_V2=true` |
| LangGraph null | `LANGGRAPH_ROLLOUT_PCT>0` or `LANGGRAPH_SHADOW=true` |
| PostgresSaver fails | Verify `POSTGRES_URL`; run `migrate:langgraph` after deploy |
| Health degraded | Set LangSmith key or accept degraded |

---

## Related

- [LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md](../architecture/ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md)
- [VIDEO_CONSULT.md](../architecture/VIDEO_CONSULT.md)
