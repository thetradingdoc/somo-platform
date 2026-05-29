# DodgeCall demo agent — decisions (ADR)

**Last updated:** 2026-05-28

## ADR-1: Custom LLM WebSocket (locked)

**Decision:** Use Retell `response_engine.type = custom-llm` with `llm_websocket_url` pointing at middleware (`/webhook/retell/llm`), same transport as Kelly.

**Rejected:** Retell-native LLM only (`general_prompt` without our WebSocket). That would require re-wiring for Phase B orchestrator, tools, and stage state.

**Implication:** Phase A implements a thin demo branch in `dodgecall-demo-handler.js`; Phase B plugs in `dodgecall-demo-orchestrator.js` without changing Retell agent type.

---

## ADR-2: `use_case` vs `template_id`

| Field | Meaning | Example |
|-------|---------|---------|
| `use_case` | Prospect-facing choice from landing form | `receptionist` |
| `template_id` | Internal registry key (agent + voice + playbook bundle) | `medical` |

**v1:** All six landing personas map to `template_id: medical` with different openers (persona flavor only).

**Later:** `use_case=debt_collection` could map to `template_id=debt_v1` with a separate Retell agent.

---

## ADR-3: Female demo voice (`DODGECALL_DEMO_VOICE_ID`)

**Pre-sprint (human):**

1. Open Retell dashboard → Agents → demo agent (or create one).
2. Audition female voices (Retell preset or ElevenLabs via `voice_id`).
3. Set `DODGECALL_DEMO_VOICE_ID=<chosen>` in `middleware-platform/.env`.
4. Run `npm run configure:dodgecall-demo --prefix middleware-platform`.

Default in code/docs until set: document only — do not fall back to Kelly `RETELL_VOICE_ID` for demo agent config.

---

## ADR-4: Rollback

Set `DODGECALL_DEMO_ENABLED=0` to disable:

- `POST /api/public/dodgecall/request-call`
- WebSocket demo branch (production Kelly path unchanged)

No deploy required if env is reloadable.

---

## ADR-5: Public webhooks

Twilio and Retell must reach middleware. `API_BASE_URL=http://localhost:4000` is insufficient for real handset tests; use ngrok or deployed host (see [RUNBOOK.md](./RUNBOOK.md)).
