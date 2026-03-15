# Video Consult — Architecture, Env & Runbook

**Last Updated:** February 2026

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

**Cost:** Vision ~$0.01/frame; end_session ~$0.05. **Scaling:** Postgres checkpointer (`LANGGRAPH_USE_POSTGRES=true`) for multi-instance. **Cleanup:** `node scripts/cleanup-video-consult-data.js` or include in retention job.

---

## 5. Related

- [HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md) — Voice vs Video vs PDF, shared RAG/codes
- [MEDIA_LAYER_ARCHITECTURE.md](./media/MEDIA_LAYER_ARCHITECTURE.md) — Media layer
- [docs/middleware-platform/LANGGRAPH_LANGSMITH.md](../middleware-platform/LANGGRAPH_LANGSMITH.md) — Tracing (video consult runs, retrieve_context metadata)
