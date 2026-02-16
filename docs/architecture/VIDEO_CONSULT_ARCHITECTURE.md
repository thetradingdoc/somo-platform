# Video Consult Architecture

**Version**: 1.0  
**Last Updated**: January 2026

---

## Overview

Multimodal telehealth video consult with AI-assisted transcription, RAG, and FHIR storage. Integrates with LiveKit video rooms and Python agents for real-time processing.

---

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LIVEKIT VIDEO ROOM (appt-{id} or consult-{random})                     │
│  Doctor ◄──► Patient                                                    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    Python Agents (transcript, vision)
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  POST /api/video-consult/agent-events                                   │
│  { room, event: transcript|vision_frame|end_session, payload }          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  VIDEO CONSULT LANGGRAPH                                                │
│  accumulate ─► [end_session] ─► retrieve_context ─► store_fhir         │
└─────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  OUTPUT                                                                 │
│  • FHIR Communication (transcript)                                      │
│  • video_consult_ai_decisions (audit)                                   │
│  • video_consult_sessions (metadata)                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Graph Nodes

| Node | Trigger | Purpose |
|------|---------|---------|
| accumulate | All events | Merge transcript/frames into state, checkpoint |
| retrieve_context | end_session only | RAG from Colab (icd10/cpt/hcpcs) from transcript |
| human_review | end_session (P2) | Create HITL task when RAG error/skip, set requires_human_review |
| store_fhir | After human_review | FHIR Communication, audit log |

---

## Event Types

| Event | Action |
|-------|--------|
| transcript | Append to state, update liveTranscripts for UI |
| vision_frame | Append to state (if canProcessFrame, cost OK) |
| end_session | Run full pipeline, store FHIR, end session |

---

## Database Tables

- **video_consult_sessions** – room_id, encounter_id, session_status, start/end_time, metadata
- **video_consult_ai_decisions** – audit (room_id, stage, findings, codes, confidence)
- **video_consult_review_tasks** – HITL (room_id, severity, assigned_to, status)

---

## FHIR Mapping

| Output | FHIR Resource |
|--------|---------------|
| Transcript | Communication |
| Visual findings | Observation (createClinicalObservation) |
| Assessment | DiagnosticReport |

---

## Cost & Throttling

- **VIDEO_CONSULT_MAX_COST_PER_SESSION** (default $10)
- Vision frame: $0.01 each
- End session FHIR: $0.05
- **VIDEO_CONSULT_MAX_FRAMES_PER_SESSION** (default 90)

---

## Security

- **VIDEO_CONSULT_AGENT_SECRET** – required for agent-events in production
- Rate limit: 1000 events/min per room
- BAA required: LiveKit, Deepgram/OpenAI

---

## P2 (Production) Features

- **HITL**: `human_review` node creates `video_consult_review_tasks` when RAG errors or skips. `GET /api/video-consult/review-tasks`.
- **Multi-participant**: Track participants via transcript/vision payloads; skip non-patient frames when `participant_identity` + `is_patient` provided.
- **Telemetry**: Node duration logging; slow-node alert when `VIDEO_CONSULT_SLOW_NODE_MS` exceeded (default 5s).
- **Data retention**: `cleanupVideoConsultData()`, 30-day sessions/decisions, 90-day resolved review tasks. Run `node scripts/cleanup-video-consult-data.js` or include in `cleanup-retention.js`.

---

## Related Docs

- [VIDEO_CONSULT_ENV.md](./VIDEO_CONSULT_ENV.md) – Environment variables
- [MEDIA_LAYER_ARCHITECTURE.md](../media/MEDIA_LAYER_ARCHITECTURE.md) – Media layer
- [MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md](../intelligence-layer/MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md) – Perception/RAG
