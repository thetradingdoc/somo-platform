# Voice Agent Documentation

**Last updated:** 2026-07-02

Kelly is the **AI front desk receptionist** for NYC dental and medical offices on **callsomo.com**. Runtime: Twilio PSTN → Cloud Run → Retell WebSocket → Kelly Rails v2 + conversation-mode dispatch.

## Start here

| Topic | Doc |
|-------|-----|
| Ops gates + deploy smoke | [`unblocked-phases-ops.md`](./unblocked-phases-ops.md) |
| Phase 2 copay / Stedi sandbox | [`phase2-pilot-checklist.md`](./phase2-pilot-checklist.md) |
| PMS connect | [`phase3-pilot-checklist.md`](./phase3-pilot-checklist.md) |
| Operator invite onboarding | [`phase4-pilot-checklist.md`](./phase4-pilot-checklist.md) |
| Architecture | [`../architecture/LIVE.md`](../architecture/LIVE.md), [`../architecture/PMS_CONNECT_ARCHITECTURE.md`](../architecture/PMS_CONNECT_ARCHITECTURE.md) |
| UX contract | [`../product/KELLY_FRONT_DESK_UX.md`](../product/KELLY_FRONT_DESK_UX.md) |

## Verify gates

```bash
cd middleware-platform
npm run verify:unblocked-phases
```

## Runtime paths (front desk)

| Path | Code |
|------|------|
| Inbound PSTN | `services/voice-incoming-handler.js` |
| Retell WSS | `webhooks/retell-websocket.js` |
| Turn resolution | `services/kelly-turn-resolver.js` |
| Conversation rails | `services/conversation-mode/*` |
| Kelly Rails v2 | `services/kelly-rails/` |
| Openers (name-first) | `services/call-opener-resolver.js` |
| Overflow / admission | `services/voice-agent-runtime.js`, `services/billing-access.js` |
| Outbound confirm | `services/conversation-mode/rails/operator-outbound-rail.js` |

### Name-first intake

Inbound openers ask for the caller's name first (`awaitingName` in `retell-websocket.js`). Opener text is resolved per tenant via `call-opener-resolver.js` — not hardcoded in prompts alone. See [`prompts/README.md`](./prompts/README.md).

### Overflow and billing admission

When credits are exhausted or concurrent lines are busy, calls forward via `buildForwardOrBlockedTwiml` **only** when `overflow_enabled` is true and `overflow_phone` is set (`migration 104`). No fallback to `transfer_number` when overflow is disabled.

### Outbound appointment confirm

Reminder calls on `operator_outbound` rail detect "yes" and execute `confirm_appointment` via `KellyToolExecutor` in the `scriptOnly` dispatch path.

## Prompts

- **[Kelly Voice Agent](./prompts/kelly-voice-agent-prompt.md)** — front-desk system prompt (dental/medical office)
- **[Kelly Chat](./prompts/kelly-chat-prompt.md)** — text channel variant
- **[Medical Voice Agent](./medical-voice-agent-prompt.md)** — coding workflow; appended by `configure-retell.js` for coding tenants only

Configure: `cd middleware-platform && node configure-retell.js` (requires `RETELL_API_KEY`, `RETELL_AGENT_ID`).

## Configuration

- **Functions:** `middleware-platform/retell-functions/retell-functions.json`
- **Voice settings API:** `routes/voice-agent-settings.js`
- **Provider UI:** `unified-dashboard/business/agent.html`, `voice-setup.html`

## Legacy telehealth path (not front-desk ICP)

Dental/medical **front desk** tenants use `healthcare_clinic` policy with triage disabled. The routine-vs-symptom OPQRST flow below applies to **legacy derm/telehealth** surfaces only:

| Step | Routine (no symptoms) | Symptom flow |
|------|----------------------|--------------|
| Triage | Skipped (`routine_no_symptoms`) | OPQRST + `run_triage_rag` |
| Slots | Routine bypass | Requires `triage_complete` + RAG |
| Schedule | Routine bypass | Requires triage row + intake complete |

Gate: `npm run verify:no-triage-front-desk`

## Debug checklist (scheduling)

- Confirm `POST /voice/appointments/available-slots` then `POST /voice/appointments/schedule` before "confirmed" wording.
- On routine visits failing `TRIAGE_REQUIRED`, check `routine_no_symptoms` in session meta.
- Overflow: verify `overflow_enabled` and `runtime.overflowNumber` in logs — not `transferNumber` fallback.

## Related documentation

- [Medical Coding](../Medical%20Coding/README.md)
- [PMS Connect Architecture](../architecture/PMS_CONNECT_ARCHITECTURE.md)
- [Front-desk production deploy](../deployment/FRONT_DESK_PRODUCTION.md)
