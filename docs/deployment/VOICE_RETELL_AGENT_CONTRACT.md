# Voice Retell agent contract

## Shared Kelly agent (operator)

- Production Kelly: `RETELL_AGENT_ID` / env on Cloud Run
- Used for: operator outbound (`operator_outbound`), sales CRM (`sales_outbound`), inbound to operator Twilio line
- Webhook: `wss://api.callsomo.com/webhook/retell/llm`

## Per-tenant agents

- SaaS customers may have `customers.retell_agent_id` for dedicated agents
- Inbound to tenant Twilio number resolves `customer_id` → `retell_agent_id`
- Fail-closed when `SAAS_VOICE_FAIL_CLOSED=1` and tenant has no agent

## Outbound

- Twilio-direct primary: `/voice/incoming?call_type=operator_outbound&customer_id=...&agent_id=...`
- Retell `create-phone-call` secondary (requires SIP trunk)

## Verification

```bash
cd middleware-platform
node configure-retell.js
node scripts/verify-agent-config.cjs
```
