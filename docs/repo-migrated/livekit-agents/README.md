# LiveKit Video Consult Agents

Python agents for real-time transcription and vision analysis in LiveKit video rooms.
Send events to middleware: `POST /api/video-consult/agent-events`.

**Last Updated:** April 9, 2026

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Environment variables

Create `.env` in this directory (or pass via deployment):

```bash
# LiveKit (required)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Middleware (agent-events endpoint)
MIDDLEWARE_URL=https://your-middleware.example.com

# STT (transcription agent)
DEEPGRAM_API_KEY=your_deepgram_key
# or
OPENAI_API_KEY=your_openai_key

# Vision (optional, when VIDEO_CONSULT_ENABLE_VISION=true)
OPENAI_API_KEY=your_openai_key
```

### 3. Agent authentication

Middleware requires `VIDEO_CONSULT_AGENT_SECRET`. Agents must send:
- Header: `X-Video-Consult-Secret: <secret>`
- Or: `Authorization: Bearer <secret>`

---

## Event payloads

### transcript

```json
{
  "room": "appt-xyz123",
  "event": "transcript",
  "payload": {
    "text": "Patient says...",
    "speaker": "patient",
    "timestamp": "2026-01-30T12:00:00Z",
    "participant_identity": "patient-1"
  }
}
```

### vision_frame

```json
{
  "room": "appt-xyz123",
  "event": "vision_frame",
  "payload": {
    "base64": "data:image/jpeg;base64,...",
    "participant_identity": "patient-1",
    "is_patient": true,
    "timestamp": "2026-01-30T12:00:05Z"
  }
}
```

### end_session

```json
{
  "room": "appt-xyz123",
  "event": "end_session",
  "payload": { "end": true }
}
```

---

## Deployment

### Transcription agent (vc-11)

The `transcription_agent.py` provides real-time STT and posts to agent-events:

```bash
# Dev (single room)
python transcription_agent.py dev

# Production (worker)
python transcription_agent.py start
```

Requires: `DEEPGRAM_API_KEY`, `MIDDLEWARE_URL`, `VIDEO_CONSULT_AGENT_SECRET`.

### Render / Railway / EC2

1. Set env vars in platform dashboard
2. Run entrypoint: `python transcription_agent.py start`
3. Agents connect to LiveKit; rooms auto-discovered or use worker

### Room naming

- Appointment-linked: `appt-{appointment_id}` (middleware resolves to encounter, patient)
- Ad-hoc: `consult-{random}` (manual encounter_id in request)

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | Yes | WebSocket URL |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `MIDDLEWARE_URL` | Yes | Base URL for agent-events |
| `DEEPGRAM_API_KEY` | STT | Deepgram for transcription |
| `OPENAI_API_KEY` | STT/Vision | Whisper or GPT-4o |

---

## Related

- [VIDEO_CONSULT.md](../docs/architecture/care-delivery/VIDEO_CONSULT.md) — flow, env vars, runbook
