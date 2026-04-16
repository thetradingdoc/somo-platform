# Video Consult — Architecture, Env & Runbook

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

**Canonical detail:** [LANDING_TRY_NOW_LIVEKIT.md](./LANDING_TRY_NOW_LIVEKIT.md).

---

## 6. Related

- [LANDING_TRY_NOW_LIVEKIT.md](./LANDING_TRY_NOW_LIVEKIT.md) — Landing UI, preview → LiveKit handoff, debugging
- [HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md) — Voice vs Video vs PDF, shared RAG/codes
- [MEDIA_LAYER_ARCHITECTURE.md](./media/MEDIA_LAYER_ARCHITECTURE.md) — Media layer
- [docs/middleware-platform/LANGGRAPH_LANGSMITH.md](../middleware-platform/LANGGRAPH_LANGSMITH.md) — Tracing (video consult runs, retrieve_context metadata)
- [VISION_UV_R_AND_D.md](./VISION_UV_R_AND_D.md) — UV imaging track (separate hardware/validation program)
