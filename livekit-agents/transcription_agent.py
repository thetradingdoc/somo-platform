"""
Video Consult Transcription Agent (vc-11)
-----------------------------------------

LiveKit agent that transcribes audio in video rooms and posts events to middleware.
- transcript: real-time STT via Deepgram, POST to /api/video-consult/agent-events
- end_session: when room empties (all participants left)

Usage:
  LIVEKIT_URL=wss://... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
  MIDDLEWARE_URL=https://... DEEPGRAM_API_KEY=... VIDEO_CONSULT_AGENT_SECRET=...
  python transcription_agent.py dev
"""

import asyncio
import os
from datetime import datetime

import httpx
from dotenv import load_dotenv
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import deepgram

load_dotenv()

MIDDLEWARE_URL = os.environ.get("MIDDLEWARE_URL", "http://localhost:4000").rstrip("/")
AGENT_SECRET = os.environ.get("VIDEO_CONSULT_AGENT_SECRET", "")

server = AgentServer()


def _post_agent_event(room: str, event: str, payload: dict) -> bool:
    """POST transcript/end_session to middleware agent-events endpoint."""
    if not MIDDLEWARE_URL:
        return False
    url = f"{MIDDLEWARE_URL}/api/video-consult/agent-events"
    headers = {"Content-Type": "application/json"}
    if AGENT_SECRET:
        headers["X-Video-Consult-Secret"] = AGENT_SECRET
    body = {"room": room, "event": event, "payload": payload}
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(url, json=body, headers=headers)
            if r.status_code >= 400:
                print(f"[transcription_agent] POST {event} failed: {r.status_code} {r.text[:200]}")
                return False
            return True
    except Exception as e:
        print(f"[transcription_agent] POST {event} error: {e}")
        return False


@server.rtc_session(agent_name="video-consult-transcriber")
async def entrypoint(ctx: JobContext):
    room_name = ctx.room.name
    ctx.log_context_fields = {"room": room_name}

    # STT: Deepgram Nova-3 (medical-capable)
    # True multilingual mode:
    # - VIDEO_STT_MODE=auto  -> language detection mode ("multi" by default)
    # - VIDEO_STT_MODE=fixed -> explicit DEEPGRAM_LANGUAGE (default "en")
    stt_mode = os.environ.get("VIDEO_STT_MODE", "auto").strip().lower()
    default_lang = "multi" if stt_mode == "auto" else "en"
    stt_language = os.environ.get("DEEPGRAM_LANGUAGE", default_lang).strip().lower() or default_lang
    try:
        stt = deepgram.STT(
            model=os.environ.get("DEEPGRAM_MODEL", "nova-3"),
            language=stt_language,
        )
    except Exception as e:
        ctx.logger.warning(f"Deepgram STT init failed: {e}. Transcription disabled.")
        stt = None

    if stt is None:
        await ctx.connect()
        return

    session = AgentSession(stt=stt)

    @session.on("user_input_transcribed")
    def on_transcript(event):
        if not getattr(event, "is_final", True):
            return
        text = getattr(event, "transcript", None) or getattr(event, "text", "") or ""
        if not text or not text.strip():
            return
        # speaker_id from diarization if available; else infer from participant
        speaker_id = getattr(event, "speaker_id", None)
        participant_id = getattr(event, "participant_identity", "") or ""
        if speaker_id:
            speaker = "provider" if str(speaker_id) == "1" else "patient"
        else:
            speaker = "provider" if any(x in (participant_id or "").lower() for x in ("provider", "doctor", "dr")) else "patient"
        payload = {
            "text": text.strip(),
            "speaker": speaker,
            "timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "participant_identity": participant_id or None,
        }
        _post_agent_event(room_name, "transcript", payload)

    # Send end_session when all remote participants leave
    async def _check_room_empty():
        await asyncio.sleep(1.0)
        try:
            count = len(list(ctx.room.remote_participants.values()))
            if count == 0:
                _post_agent_event(room_name, "end_session", {"end": True})
        except Exception:
            pass

    def on_disconnected(participant, *args):
        asyncio.create_task(_check_room_empty())

    try:
        ctx.room.on("participant_disconnected", on_disconnected)
    except Exception:
        pass

    await session.start(
        agent=Agent(instructions="You are a medical transcription assistant. Transcribe all speech accurately."),
        room=ctx.room,
    )
    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
