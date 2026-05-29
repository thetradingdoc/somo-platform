# DodgeCall demo agent todos

**Status:** In progress (implementation 2026-05-28)  
**Scope:** Conversion demo agent — isolated from Kelly/LangGraph  
**Docs:** [`docs/agent/dodgecall/ARCHITECTURE.md`](../../docs/agent/dodgecall/ARCHITECTURE.md)

## Critical path

`P0` → `A1` → `A4` → `A6/A7` → `A9` → `B3` → `B4` → `N1–N6`

---

## P0 — Pre-sprint (human + ADR)

- [ ] **P0-1** Audition female voice; set `DODGECALL_DEMO_VOICE_ID` in `.env`
- [ ] **P0-2** ADR: custom LLM WebSocket — [`DECISIONS.md`](../../docs/agent/dodgecall/DECISIONS.md)
- [ ] **P0-3** Document `use_case` vs `template_id` — [`TEMPLATE_REGISTRY.md`](../../docs/agent/dodgecall/TEMPLATE_REGISTRY.md)
- [ ] **P0-4** Playbook outline — [`PLAYBOOK_MEDICAL.md`](../../docs/agent/dodgecall/PLAYBOOK_MEDICAL.md)
- [ ] **P0-5** Public `API_BASE_URL` (ngrok/deployed) for Twilio

---

## Phase A — Demo tenant + WS fork

| ID | Task | Files | Done |
|----|------|-------|------|
| A0 | use_case → template_id map | `config/dodgecall-templates.json` | [x] |
| A1 | Template registry module | `services/dodgecall-template-registry.js` | [x] |
| A2 | Env example vars | `.env.example` | [x] |
| A3 | Store `template_id` on demo request | `dodgecall-demo-service.js`, `database.js` | [x] |
| A4 | Configure Retell demo agent script | `scripts/configure-dodgecall-demo-retell.cjs` | [x] |
| A6 | Outbound via registry; fail fast | `outbound-call-service.js` | [x] |
| A7 | Inbound demo number → dodgecall_demo | `server.js` | [x] |
| A9a | `DODGECALL_DEMO_ENABLED` gates WS | `dodgecall-demo-handler.js` | [x] |
| A9b | Detect `call_type=dodgecall_demo` | `dodgecall-demo-handler.js` | [x] |
| A9c | Isolated demo handler module | `webhooks/dodgecall-demo-handler.js` | [x] |
| A9d | Early return before LangGraph/Kelly | `retell-websocket.js` | [x] |
| A10 | Demo greeting (Sam / DodgeCall) | `dodgecall-demo-handler.js` | [x] |
| A10b | Map `prospect_name` from dynamic vars | `retell-websocket.js` | [x] |
| A11 | Skip Kelly on demo | `retell-websocket.js` | [x] |
| A12 | Skip LangGraph on demo | `retell-websocket.js` | [x] |
| A13 | Custom LLM path only (no Retell-native-only) | ADR + handler | [x] |
| A14 | `npm run configure:dodgecall-demo` | `package.json` | [x] |
| A17 | Rollback doc | `RUNBOOK.md` | [x] |

---

## Phase B — Conversion orchestrator

| ID | Task | Files | Done |
|----|------|-------|------|
| B1 | Stage enum + state machine | `dodgecall-demo-orchestrator.js` | [x] |
| B2 | Prompt builder (playbook) | `dodgecall-prompt-builder.js` | [x] |
| B3 | Full playbook content | `PLAYBOOK_MEDICAL.md` | [x] |
| B4 | Orchestrator `processTurn` | `dodgecall-demo-orchestrator.js` | [x] |
| B6 | Tools: `record_interest`, `send_signup_link`, `end_call` | handler + configure script | [x] |
| B8 | SMS signup via `dodgecall-sms.js` | `services/dodgecall-sms.js` | [x] |
| B9 | DB columns: stage, interest, outcome, etc. | `database.js` | [x] |
| B10 | Status callback → outcome/duration | `server.js` | [x] |
| B11 | Landing consent (call + SMS) | `DemoSection.jsx` | [x] |

---

## Safety (N1–N6)

| ID | Task | Done |
|----|------|------|
| N1 | Max call duration (default 240s) | [x] |
| N2 | `end_call` + Twilio hangup optional | [x] |
| N3 | AMD + voicemail/no-answer outcomes | [x] |
| N4 | Consent copy for SMS | [x] |
| N5 | Dedicated SMS wrapper | [x] |
| N6 | Daily cap + max concurrent | [x] |

---

## Phase C/D — Light

| ID | Task | Done |
|----|------|------|
| C1 | Registry schema for future templates | [x] |
| C2 | `attribution_json` on demo requests | [x] |
| D1 | Unit tests registry + demo detection | [x] |
| D2 | E2E consent wording | [x] |
| D3 | Smoke script flag-off | [x] |

---

## Acceptance (E2E)

- Demo API disabled when `DODGECALL_DEMO_ENABLED=0`
- Demo call does not log `KellyAgentService.processTurn`
- Greeting uses DodgeCall / Sam + prospect name
- `npm run test:e2e-dodgecall` passes
- `npm test -- dodgecall` passes
