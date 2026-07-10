# Voice Retell agent contract — shared agent ≠ shared behavior (DOC-2)

**SSOT:** This file supersedes [`deployment/VOICE_RETELL_AGENT_CONTRACT.md`](../deployment/VOICE_RETELL_AGENT_CONTRACT.md) (redirect stub only).

One Retell agent ID may serve multiple **routing worlds**. Inbound behavior is determined at runtime by:

1. **`to_number`** — demo line vs tenant DID (`voice-routing-world.js`)
2. **`call_type`** — `somo_demo`, `operator_outbound`, `inbound_tenant` (Twilio register + dynamic variables)
3. **`customer_id`** — tenant resolution (R-5b); required for Kelly Rails clinical/booking on tenant DIDs

## Branching

| Resolved world | WebSocket branch |
|----------------|------------------|
| `demo` | `somo-demo-handler` — no `runKellyTurn` |
| `unidentified` | Kelly blocked; handoff script |
| `tenant` | `runKellyTurn` → Kelly Rails V2 |
| `operator_outbound` | Kelly with `operator-outbound-rail` |
| `platform_support` | Admin + handoff; triage disabled |

## Required Retell dynamic variables

`call_type`, `customer_id`, `clinic_id`, `direction`, `to_number`, `from_number`, `demo_request_id` (demo), `appointment_id` / `outbound_purpose` (outbound).

## Per-tenant agents

- SaaS customers may have `customers.retell_agent_id` for dedicated agents.
- Inbound to tenant Twilio number resolves `customer_id` → `retell_agent_id`.
- Fail-closed when `SAAS_VOICE_FAIL_CLOSED=1` and tenant has no agent.

## Outbound

- Twilio-direct primary: `/voice/incoming?call_type=operator_outbound&customer_id=...&agent_id=...`
- Retell `create-phone-call` secondary (requires SIP trunk alignment).

## Verification

```bash
cd middleware-platform
node configure-retell.js
node scripts/verify-agent-config.cjs
npm run verify:voice-identity-vars
```

See [PLATFORM_NUMBER_INBOUND_SPEC.md](./PLATFORM_NUMBER_INBOUND_SPEC.md) and [VOICE_ROUTING_SSOT.md](./VOICE_ROUTING_SSOT.md).
