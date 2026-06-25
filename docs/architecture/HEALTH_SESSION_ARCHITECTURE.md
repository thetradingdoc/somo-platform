# Health Session Architecture

**Last updated:** 2026-06-25  
**Master plan:** `~/.cursor/plans/somo_health_session_architecture_723cc4d3.plan.md` (SSOT for tasks)

Consumer product: **Safe VideoGPT for Healthcare** — educational multilingual video health chat. Kelly is a **physician assistant**, not a diagnosing physician.

---

## UI surfaces

| Surface | File | User | Room ID |
|---------|------|------|---------|
| Consumer health chat | `unified-dashboard/health-video-landing/` (`/health-video/`) | Anonymous | `health-{uuid}` |
| Provider clinical HUD | `unified-dashboard/business/video-call.html` | Clinician | `appt-*` (frozen) |
| Patient appointment video | `unified-dashboard/patients/video-call.html` | Logged-in patient | `appt-*` (P4) |

**Routing:** `localhost:4000/` → `/health-video/` when `LOCAL_DEV_ROOT=health`. B2B entry stays `/business/trial-activation.html`.

---

## Data journey

```
Terms → POST /api/health-session/start → health_sessions + session_token + sse_token
Call  → LiveKit connect + Deepgram STT → agent-events transcript (is_final)
Chat  → kelly-pa-video-orchestrator → SSE assistant_message + tool_event
Report → POST /:id/end + session_token → health_session_reports
```

### Database (migration 085 + 086)

| Table | Purpose |
|-------|---------|
| `health_sessions` | Session row: locale, reply_language, terms_version, session_token, metadata_json |
| `health_session_transcripts` | Persisted final transcript lines (speaker, text, text_original, text_translated) |
| `health_session_reports` | Structured report JSON on end |

In-memory `video_consult_sessions` live transcript is used during the call; reports read DB first (`p2-report-from-db`).

---

## Agent stack scope (NOT LangGraph / NOT Pinecone coding)

Health MVP uses a **lightweight Groq tool loop** — intentionally outside `kelly-rails` and `video-consult-graph`.

| Stack | Repo location | Health MVP |
|-------|---------------|------------|
| LangGraph (`kelly-rails`, `video-consult-graph`) | `services/kelly-rails/`, `video-consult-graph.js` | **Do not wire** |
| Pinecone ICD/CPT coding RAG | `pinecone-code-metadata-client.js` | **Disabled** on `health-*` |
| RAG education (`RAG_EDUCATION_URL`) | `patient-education-client.js` | Derm tool only |
| Groq PA orchestrator | `kelly-pa-video-orchestrator.js` | **Core agent** |
| Optional LangSmith | `chat-llm-service.js` ChatGroq pattern | Nice-to-have |

### Health isolation guards (`video-consult.js`)

- `scheduleRealtimeCodeFetch` — skip for `health-*`
- `videoConsultGraph.processEvent` on **all** `health-*` agent-events — skip; Kelly orchestrator + `healthSessionReport.finalizeSession` on end only
- `video-consult-assistant-service` provider copilot — skip for `health-*`

---

## File map

| Layer | Path |
|-------|------|
| API routes | `routes/health-session.js` |
| Session service | `services/health-session-service.js` |
| Kelly wire | `services/health-video-kelly-service.js` |
| PA prompt | `services/kelly-pa-video-prompt.js` |
| Orchestrator | `services/kelly-pa-video-orchestrator.js` |
| Model router | `services/health-video-model-router.js` |
| Tools | `services/video-tool-registry.js` |
| OPQRST | `services/health-video-opqrst.js` |
| Report | `services/health-session-report-service.js` |
| SSE schema | `services/video-consult-sse-schema.js` |
| Agent events | `routes/video-consult.js` |
| STT worker | `livekit-agents/transcription_agent.py` |
| Consumer UI | `unified-dashboard/health-video-landing/` |
| UI modules | `unified-dashboard/health-video-landing/src/` |

---

## Model routing

| Layer | Default | Escalation |
|-------|---------|------------|
| Orchestrator | Groq `llama-3.1-8b-instant` | Groq `llama-3.3-70b-versatile` (multi-tool) |
| Derm compose | Groq 70b | — |
| Vision caption | YOLO tags | Anthropic when frame quality ≥ good |
| Report | Groq 8b | — |

Env: `GROQ_API_KEY`, `HEALTH_ORCHESTRATOR_MODEL`, `HEALTH_REPORT_MODEL`, `ANTHROPIC_API_KEY` (vision only).

---

## Session auth design

1. **Session token** — returned from `POST /start`; required on `POST /:id/end`, `GET /:id/report`, `GET /:id/transcript`.
2. **SSE token** — short-lived query param `?token=` on `GET /api/video-consult/sse/:roomId` for `health-*` rooms.
3. **Agent events** — `X-Video-Consult-Secret` header (`VIDEO_CONSULT_AGENT_SECRET`).

---

## Environment

| Variable | Purpose |
|----------|---------|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Video rooms |
| `DEEPGRAM_API_KEY` | STT agent |
| `VIDEO_CONSULT_AGENT_SECRET` | agent-events auth |
| `GROQ_API_KEY` | Kelly + report |
| `MIDDLEWARE_URL` | Transcription agent callback |
| `DERM_EDUCATION_PIPELINE_ENABLED`, `RAG_EDUCATION_URL` | Derm tool |
| `LOCAL_DEV_ROOT=health` | Root → consumer health page |

Dev bootstrap: `npm run health:dev` (server + env verify + transcription agent).

---

## Compliance posture

### Demo (P2)

- Informed consent with `terms_version` stored on session
- Subprocessors disclosed: Deepgram, LiveKit, Groq, Anthropic (vision optional)
- Not diagnosis / not emergency — UI copy on terms, call, report
- Retention TTL in `config/retention-policy.js` (`health_sessions`, `health_session_transcripts`, `health_session_reports`)
- `hipaa_access_log` on report fetch and session end
- Session + SSE tokens — no open roomId streams

### Production HIPAA (beyond P2)

- BAAs with all subprocessors
- Encryption at rest for PHI tables
- Audit log review process
- Data subject access / deletion workflows

---

## MVP out of scope

- Payment / copay (P3)
- Specialist booking / provider handoff (P4)
- Claims / USDC payout (P5)
- `kelly-rails` voice booking complexity
- Pinecone coding RAG on health transcript
- File upload (camera capture only)

---

## USDC / finance reference

Path 4 finance rails attach after P2 stable. See master plan P3–P5 tasks.
