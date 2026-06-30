# Somo Health Agent Architecture

**SSOT for consumer `/health-video/` agent orchestration.**

## Stack

| Layer | Module |
|-------|--------|
| API | `routes/health-session.js`, `routes/health-transport.js` |
| Session | `services/health/session-service.js` |
| Turn | `services/health/turn-service.js` |
| Agent | `services/health/agent/orchestrator.js` (`runHealthTurn`) |
| Prompt | `services/health/agent/prompt.js` (identity: **Somo**) |
| Tools | `services/health/tools/registry.js`, `tools/derm-pipeline.js` |
| Safety | `services/health/safety-floor.js`, `diagnosis-guard.js` |
| Transport | `services/health/transport/` (SSE + agent-events) |
| Report | `services/health/report-service.js` |

## Turn ingress contract

See `services/health/turn-contract.js`.

| Mode | Path | Default |
|------|------|---------|
| `ui_turn` | `POST /api/health-session/:id/turn` | **on** |
| `stt` | `POST /api/health-session/agent-events` transcript | off unless `HEALTH_SERVER_STT_ENABLED=1` and `HEALTH_BROWSER_STT_ONLY=0` |

Idempotency: utterance hash dedupes cross-path duplicates (`turn-service`).

## Explicitly excluded

- `kelly-rails/`, `video-consult-graph`, Pinecone coding RAG
- `KellyToolExecutor` (derm uses `tools/derm-pipeline.js`)

## Isolation

CI: `npm run check:health-imports`

Tests: `__tests__/health-video-isolation.test.js`

## Related

- [HEALTH_SESSION_ARCHITECTURE.md](./HEALTH_SESSION_ARCHITECTURE.md)
- [SESSION_SSOT_MATRIX.md](./SESSION_SSOT_MATRIX.md)
- [OPQRST_BOUNDARIES.md](./OPQRST_BOUNDARIES.md)
