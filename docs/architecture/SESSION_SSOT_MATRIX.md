# Session SSOT matrix

| Product | Authoritative store | Ephemeral | Agent brain |
|---------|---------------------|-----------|-------------|
| **Somo health video** | `health_sessions`, `health_session_transcripts`, `health_session_reports` | SSE via `health/transport/sse-bus` | `services/health/agent/orchestrator` |
| **B2B Kelly voice** | `kelly_rails_session_projection`, `voice_call_log` | Retell WS session | `conversation-mode` + `kelly-rails` |
| **Provider video HUD** | `video_consult_sessions` (in-memory + DB) | `video-consult-sse` | `video-consult-graph` |

Health sessions **do not** create `video_consult_sessions` rows (Phase 1D).
