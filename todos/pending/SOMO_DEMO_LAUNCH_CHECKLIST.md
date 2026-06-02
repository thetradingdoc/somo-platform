# Somo demo — launch checklist (human / ops)

**Status:** Code complete — see [`../archive/DODGECALL_DEMO_AGENT_TODOS_COMPLETED_2026-05-31.md`](../archive/DODGECALL_DEMO_AGENT_TODOS_COMPLETED_2026-05-31.md)  
**Docs:** [`docs/agent/somo-demo/RUNBOOK.md`](../../docs/agent/somo-demo/RUNBOOK.md)

## P0 — Before first production demo call

- [ ] **P0-1** Audition female voice; set `SOMO_DEMO_VOICE_ID` (or legacy `DODGECALL_DEMO_VOICE_ID`) in `.env`
- [ ] **P0-2** ADR signed: custom LLM WebSocket — [`DECISIONS.md`](../../docs/agent/somo-demo/DECISIONS.md)
- [ ] **P0-3** Document `use_case` vs `template_id` — [`TEMPLATE_REGISTRY.md`](../../docs/agent/somo-demo/TEMPLATE_REGISTRY.md)
- [ ] **P0-4** Playbook outline reviewed — [`PLAYBOOK_MEDICAL.md`](../../docs/agent/somo-demo/PLAYBOOK_MEDICAL.md)
- [ ] **P0-5** Public `API_BASE_URL` (ngrok or deployed) reachable from Twilio

## Acceptance smoke

- [ ] `SOMO_DEMO_ENABLED=0` (or legacy `DODGECALL_DEMO_ENABLED=0`) disables demo API
- [ ] Demo call does not log `KellyAgentService.processTurn`
- [ ] `npm run test:e2e-somo-demo` (or legacy `test:e2e-dodgecall`) passes
- [ ] `npm test -- somo-demo` passes
