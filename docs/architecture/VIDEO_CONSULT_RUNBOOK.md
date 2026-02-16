# Video Consult Runbook

**Last Updated**: January 2026

---

## Local Testing

### Run Unit Tests (with writable DB)

Use the project-local script so the DB is writable (avoids `SQLITE_READONLY`):

```bash
./scripts/test-video-consult-local.sh
```

Or manually with a writable DB:

```bash
cd middleware-platform
DB_PATH=./video-consult-test.db node tests/video-consult-state.test.js
```

### E2E via API (curl)

1. Start the server: `./start-local.sh`
2. Send transcript events:

```bash
curl -X POST http://localhost:4000/api/video-consult/agent-events \
  -H 'Content-Type: application/json' \
  -d '{"room":"appt-test-1","event":"transcript","payload":{"text":"Patient has a rash","speaker":"patient"}}'
```

3. End session to trigger FHIR storage:

```bash
curl -X POST http://localhost:4000/api/video-consult/agent-events \
  -H 'Content-Type: application/json' \
  -d '{"room":"appt-test-1","event":"end_session","payload":{"end":true}}'
```

The graph creates a patient and encounter if needed (for test IDs like `p1` / `enc-1`).

---

## Troubleshooting

### LiveKit "Invalid URL" or Token Failures

**Symptom**: Video rooms fail to connect, `Failed to construct 'URL': Invalid URL`

**Fix**:
1. Set `LIVEKIT_URL` to valid WebSocket URL: `wss://your-project.livekit.cloud` (no trailing slash)
2. Get credentials from https://cloud.livekit.io
3. Restart middleware after env change

### Agent-Events 401 Unauthorized

**Symptom**: Python agents get 401 on `POST /api/video-consult/agent-events`

**Fix**:
1. Set `VIDEO_CONSULT_AGENT_SECRET` in middleware .env
2. Python agents must send: `X-Video-Consult-Secret: <secret>` or `Authorization: Bearer <secret>`
3. In dev, if secret is unset, auth is skipped

### RAG Returns Empty / RAG_ERROR_FALLBACK

**Symptom**: `current_stage: RAG_FALLBACK_EMPTY` or `RAG_ERROR_FALLBACK`

**Fix**:
1. Check `RAG_API_URL` is set and reachable
2. Colab RAG must be running; health: `GET {RAG_API_URL}/health`
3. RAG retries 2x (configurable via `RAG_RETRIES`)

### FHIR Storage Fails

**Symptom**: `FHIR_ERROR`, transcript not persisted

**Fix**:
1. Check FHIR DB (SQLite/Postgres) writable
2. Verify `patient_id`, `encounter_id` from room resolution
3. Room `appt-{id}` → `getAppointment(id)` → encounter, patient

### Cost Exceeded / BUDGET_EXCEEDED

**Symptom**: `stage: BUDGET_EXCEEDED`, frames skipped

**Fix**:
1. `VIDEO_CONSULT_MAX_COST_PER_SESSION` (default $10)
2. `VIDEO_CONSULT_MAX_FRAMES_PER_SESSION` (default 90)
3. Vision cost ~$0.01/frame; end_session FHIR ~$0.05
4. Increase limits or disable vision: `VIDEO_CONSULT_ENABLE_VISION=false`

---

## Cost Monitoring

| Metric | Where | Alert |
|--------|-------|-------|
| Cost/session | `token-budget.getVideoConsultCost(room)` | Console warn when ≥ $15 |
| Long session | Route `end_session` | Console warn when > 5min |
| Slow node | Graph telemetry | Console warn when node > 5s |

**Env**:
- `VIDEO_CONSULT_COST_ALERT_THRESHOLD` (default 15)
- `VIDEO_CONSULT_SLOW_NODE_MS` (default 5000)

---

## Scaling

- **Concurrent rooms**: In-memory checkpointer; use Postgres (`LANGGRAPH_USE_POSTGRES=true`) for multi-instance
- **Rate limit**: 1000 events/min per room (configurable in route)
- **Cleanup**: Run `node scripts/cleanup-video-consult-data.js` or `cleanup-retention.js` daily

---

## BAA / HIPAA

- Set `BAA_ACKNOWLEDGED=true` when BHAs are in place with LiveKit, Deepgram/OpenAI
- AI decisions logged to `video_consult_ai_decisions` (patient_id, timestamp, model)
- HITL tasks in `video_consult_review_tasks` for human review

---

## Related

- [VIDEO_CONSULT_ARCHITECTURE.md](./VIDEO_CONSULT_ARCHITECTURE.md)
- [VIDEO_CONSULT_ENV.md](./VIDEO_CONSULT_ENV.md)
