# DodgeCall demo — isolation contract

**Last updated:** 2026-05-28

Demo calls (`call_type=dodgecall_demo`) must **never** execute the following on the WebSocket path:

| Must NOT run | Module / behavior |
|--------------|-------------------|
| Kelly LLM + tools | `kelly-agent-service.js`, `kelly-tool-executor.js` |
| LangGraph / coding state | `coding-graph.js`, `coding-state-service.js` |
| Medical triage RAG | `triage-service.js` on demo path |
| Clinic tenant resolution for billing | Billing gate skipped at Twilio ingress only |
| Full Kelly `retell-functions.json` on demo Retell agent | Demo agent: `end_call`, `record_interest`, `send_signup_link` only |

## Allowed on demo path

- `dodgecall-demo-handler.js`
- `dodgecall-demo-orchestrator.js`
- `dodgecall-prompt-builder.js` (playbook + signup CTA)
- `dodgecall-sms.js` (signup link; dedicated FROM env)
- `dodgecall-template-registry.js`
- DB: `dodgecall_demo_requests` only (no `rcm_journeys` / Kelly session coupling required)

## Ingress exceptions

On `/voice/incoming` when `call_type=dodgecall_demo`:

- Skip subscription/billing gate (already implemented).
- Use `DODGECALL_RETELL_AGENT_ID` + `DODGECALL_TWILIO_FROM_NUMBER` from template registry.
- Inbound calls to the demo Twilio number are treated as demo (no `getCustomerByTwilioNumber` match).

## Enforcement

`isDodgecallDemoConnection(connection)` in `dodgecall-demo-handler.js` requires:

1. `DODGECALL_DEMO_ENABLED` not `0` / `false`
2. `call_type === 'dodgecall_demo'` in metadata or dynamic variables

`retell-websocket.js` returns early to demo handler **before** LangGraph (~578) and Kelly (~627).
