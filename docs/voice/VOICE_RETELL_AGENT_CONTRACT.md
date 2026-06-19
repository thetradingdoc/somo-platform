# Voice Retell agent contract — shared agent ≠ shared behavior (DOC-2)

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

See [PLATFORM_NUMBER_INBOUND_SPEC.md](../voice/PLATFORM_NUMBER_INBOUND_SPEC.md).
