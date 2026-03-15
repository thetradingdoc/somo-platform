# DocLittle Media Layer – Architecture Document

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
| **Docs** | `docs/middleware-platform/RETELL_CONFIG_QUICK_REFERENCE.md` |

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

See [VIDEO_CONSULT.md](../VIDEO_CONSULT.md).

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
- Documentation: `docs/architecture/financial/FINANCIAL_LAYER_ARCHITECTURE.md`

---

## Appendix: LiveKit References

- [LiveKit Egress](https://docs.livekit.io/transport/media/ingress-egress/egress/) – Recording, export
- [LiveKit Agents – Transcriptions](https://docs.livekit.io/agents/v0/voice-agent/transcriptions) – Real-time transcription in agent sessions
- [LiveKit Cloud SIP](https://docs.livekit.io/) – SIP (used by Retell)

---

*Created: January 2026. Media layer architecture for DocLittle.*
