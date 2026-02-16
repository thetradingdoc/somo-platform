# Video Consult – Environment Variables

**Last Updated**: January 2026

---

## Required (Video + LiveKit)

```bash
# LiveKit Cloud – Video room URL
# Format: wss://your-project.livekit.cloud
# Get from: https://cloud.livekit.io
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

**Note:** If these are missing or invalid, video calls will fail with "Failed to construct 'URL': Invalid URL". Ensure `LIVEKIT_URL` is a valid WebSocket URL (e.g. `wss://`, no trailing slash unless part of path).

---

## Optional (Video Consult AI)

```bash
# Agent authentication – required in production
# Python agents must send: X-Video-Consult-Secret: <secret> or Authorization: Bearer <secret>
VIDEO_CONSULT_AGENT_SECRET=your_shared_secret

# Max frames per session (1 frame/10s × 15min ≈ 90)
VIDEO_CONSULT_MAX_FRAMES_PER_SESSION=90

# Max cost per session (USD) – throttling for vision/LLM
VIDEO_CONSULT_MAX_COST_PER_SESSION=10

# Enable vision/dermatology analysis (default: false until cost-proven)
VIDEO_CONSULT_ENABLE_VISION=false

# Slow node alert threshold (ms) – log warning if node exceeds (P2 telemetry)
VIDEO_CONSULT_SLOW_NODE_MS=5000

# STT for Python transcription agent
DEEPGRAM_API_KEY=...
# or
OPENAI_API_KEY=...
```

---

## HIPAA / BAA (Production)

**vc-security-4:** Before processing PHI in production, ensure BHAs (Business Associate Agreements) are in place with:

- **LiveKit** (video/audio transport)
- **Deepgram** or **Whisper/OpenAI** (STT)
- Any other vendors that receive PHI

Set `BAA_ACKNOWLEDGED=true` in env to silence startup warning (indicates you have completed BAA review).

---

## Python Agents (livekit-agents/)

Agents use their own env; pass via deployment:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` – Connect to rooms
- `MIDDLEWARE_URL` – Base URL for `POST /api/video-consult/agent-events`
- `DEEPGRAM_API_KEY` or `OPENAI_API_KEY` – STT
- `OPENAI_API_KEY` – Vision (GPT-4o) when enabled

---

## Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LIVEKIT_URL` | Yes | - | WebSocket URL for LiveKit Cloud |
| `LIVEKIT_API_KEY` | Yes | - | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | - | LiveKit API secret |
| `VIDEO_CONSULT_AGENT_SECRET` | No* | - | Shared secret for agent-events auth |
| `VIDEO_CONSULT_MAX_FRAMES_PER_SESSION` | No | 90 | Max vision frames per session |
| `VIDEO_CONSULT_MAX_COST_PER_SESSION` | No | 10 | Max $ per session (throttling) |
| `VIDEO_CONSULT_ENABLE_VISION` | No | false | Enable vision/dermatology analysis |
| `VIDEO_CONSULT_SLOW_NODE_MS` | No | 5000 | Slow-node alert threshold (ms) |
| `VIDEO_CONSULT_COST_ALERT_THRESHOLD` | No | 15 | Cost alert $ per session |
| `RAG_RETRIES` | No | 2 | Retries for Colab RAG API (vc-error-1) |
| `DEEPGRAM_API_KEY` | No* | - | STT (Python agent) |
| `OPENAI_API_KEY` | No* | - | STT/Vision (Python agent) |
| `BAA_ACKNOWLEDGED` | No | false | Set true when BHAs are in place |

\* Required for transcription agent when deployed; `VIDEO_CONSULT_AGENT_SECRET` required in production
