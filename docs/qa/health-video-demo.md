# Health video demo — acceptance checklist

**Last updated:** 2026-06-25  
**Architecture:** [`HEALTH_SESSION_ARCHITECTURE.md`](../architecture/HEALTH_SESSION_ARCHITECTURE.md)

## P0 acceptance

- [x] `docs/architecture/HEALTH_SESSION_ARCHITECTURE.md` exists
- [x] `.cursor/rules/health-session-architecture.mdc` exists
- [x] `VIDEO_HEALTH.md` points to arch doc (not AgentBrain)
- [x] `npm run ci:phase0` green

## Env (middleware-platform/.env)

| Variable | Required | Notes |
|----------|----------|-------|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Yes | Video rooms |
| `DEEPGRAM_API_KEY` | **Not Phase 1** — use browser STT; enable `HEALTH_SERVER_STT_ENABLED` for Post-MVP | Optional in dev — browser STT fallback in UI |
| `VIDEO_CONSULT_AGENT_SECRET` | agent-events auth | Optional in dev |
| `GROQ_API_KEY` | Yes | Kelly PA + report |
| `DERM_EDUCATION_PIPELINE_ENABLED` | Derm tool | `true` to enable skin Q&A |
| `RAG_EDUCATION_URL` | Derm tool | Education RAG `/retrieve_passages` |
| `LOCAL_DEV_ROOT=health` | Dev root | Default — `localhost:4000/` → `/health-video/` |

## UI

React funnel: `unified-dashboard/health-video-landing/` — see [`HEALTH_VIDEO_UX.md`](../product/HEALTH_VIDEO_UX.md).

```bash
npm run health:ui:build   # serve via ./run at /health-video/
npm run health:ui:dev     # Vite :5174 with API proxy
```

Verify (optional): `npm run health:verify-env`

## Dev bootstrap

```bash
cd middleware-platform
npm start
# or: ./run from repo root
```

Single Node process on `:4000`. Browser STT in health-video React app — no Deepgram or Python agent required.

## Post-MVP (optional)

| Feature | Env | Notes |
|---------|-----|-------|
| Server STT (Deepgram + LiveKit agent) | `HEALTH_SERVER_STT_ENABLED=true`, `VITE_HEALTH_SERVER_STT_ENABLED=true` | Run `livekit-agents/transcription_agent.py`; browser STT disabled in UI |
| Kelly TTS | `VITE_HEALTH_TTS_ENABLED=true` | Free browser `speechSynthesis` via `useKellyTts.js` |

Voice / Retell webhooks in production use `https://api.callsomo.com` — no local ngrok for health MVP.

## P1 acceptance (curl)

```bash
# Start session
START=$(curl -s -X POST http://localhost:4000/api/health-session/start \
  -H 'Content-Type: application/json' \
  -d '{"terms_accepted":true,"locale":"en","reply_language":"en"}')
ROOM=$(echo "$START" | jq -r '.session.room_id')
SECRET="${VIDEO_CONSULT_AGENT_SECRET}"

# Simulate patient transcript
curl -s -X POST "http://localhost:4000/api/video-consult/agent-events" \
  -H "Content-Type: application/json" \
  -H "X-Video-Consult-Secret: $SECRET" \
  -d "{\"room\":\"$ROOM\",\"event\":\"transcript\",\"payload\":{\"text\":\"I have a rash on my arm for two days\",\"speaker\":\"patient\",\"is_final\":true}}"

# Dev turn (no STT)
SID=$(echo "$START" | jq -r '.session.id')
curl -s -X POST "http://localhost:4000/api/health-session/$SID/turn" \
  -H 'Content-Type: application/json' \
  -d '{"text":"I have a mild rash on my arm"}'
```

Kelly reply should appear via SSE within 10s.

## P2 acceptance (full journey)

```
open http://localhost:4000  (LOCAL_DEV_ROOT=health)
→ Safe VideoGPT for Healthcare home
→ accept terms + privacy link
→ permission primer → camera/mic
→ speak → patient + Kelly bubbles visible
→ end (confirm) → structured report
→ ci:phase0 green
```

## Multilingual (Kenya demo)

Repeat with `"locale":"sw","reply_language":"sw"`. Report should be Swahili with English clinical stub.

## RAG env checklist (derm)

```bash
export DERM_EDUCATION_PIPELINE_ENABLED=true
export RAG_EDUCATION_URL=http://localhost:8080  # or your education service
```

If unset, `analyze_skin_concern` abstains; general chat still works.
