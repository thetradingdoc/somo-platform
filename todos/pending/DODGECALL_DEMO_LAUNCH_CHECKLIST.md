# DodgeCall demo — launch checklist (human / ops)

**Status:** Code complete — see [`../archive/DODGECALL_DEMO_AGENT_TODOS_COMPLETED_2026-05-31.md`](../archive/DODGECALL_DEMO_AGENT_TODOS_COMPLETED_2026-05-31.md)  
**Docs:** [`docs/agent/dodgecall/RUNBOOK.md`](../../docs/agent/dodgecall/RUNBOOK.md)

## P0 — Before first production demo call

- [ ] **P0-1** Audition female voice; set `DODGECALL_DEMO_VOICE_ID` in `.env`
- [ ] **P0-2** ADR signed: custom LLM WebSocket — [`DECISIONS.md`](../../docs/agent/dodgecall/DECISIONS.md)
- [ ] **P0-3** Document `use_case` vs `template_id` — [`TEMPLATE_REGISTRY.md`](../../docs/agent/dodgecall/TEMPLATE_REGISTRY.md)
- [ ] **P0-4** Playbook outline reviewed — [`PLAYBOOK_MEDICAL.md`](../../docs/agent/dodgecall/PLAYBOOK_MEDICAL.md)
- [ ] **P0-5** Public `API_BASE_URL` (ngrok or deployed) reachable from Twilio

## Acceptance smoke

- [ ] `DODGECALL_DEMO_ENABLED=0` disables demo API
- [ ] Demo call does not log `KellyAgentService.processTurn`
- [ ] `npm run test:e2e-dodgecall` passes
- [ ] `npm test -- dodgecall` passes
