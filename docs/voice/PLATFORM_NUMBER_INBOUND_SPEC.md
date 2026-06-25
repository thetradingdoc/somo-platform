# Platform number inbound spec

**Status:** Active (patient navigator P1)  
**Primary platform DID:** `+13639990205` (Twilio `TWILIO_PHONE_NUMBER` / `CALLSOMO_OPERATOR_TWILIO_NUMBER`)

## Purpose

The platform inbound line is the **consumer-facing Somo Health patient navigator** PSTN entry. Callers get need-first navigation: care need → plan → ZIP → one ranked in-network recommendation with copay in context → contact info only.

Kelly Rails clinical intake (`store_triage_opqrst`, `triage_sessions`) must **never** run on this line. Legacy Somo demo qualification and somo-landing outbound demos are retired.

## Routing worlds

| World | When | Agent path | Clinical |
|-------|------|------------|----------|
| `navigation` | Inbound to platform DID with `cust-navigation-demo` on DID | `consumer-navigation-handler` | **No** |
| `platform_support` | Operator `customer_type` with resolved `customer_id` | Admin + handoff/callback | **No** |
| `tenant` | Inbound to tenant DID with `customer_id` | Full Kelly Rails V2 | Per tenant policy |
| `operator_outbound` | Outbound from operator account | `operator-outbound-rail` | **No** |
| `unidentified` | No `customer_id`, not navigation line | Fail-closed admin + handoff | **No** |

## Ingress (no Twilio reconfig)

Twilio may keep the existing voice URL. Server-side:

1. `resolveNavigationInboundByDid` binds inbound `To` → `cust-navigation-demo` when `NAVIGATION_ENABLED=1`.
2. `routing_world=navigation` on Retell WebSocket.
3. `cust-navigation-demo.retell_agent_id` set via `NAVIGATION_RETELL_AGENT_ID` or `RETELL_AGENT_ID`.

## Caller intents on platform inbound (P1)

| Caller says | Expected behavior |
|-------------|-------------------|
| Care need (dentist, braces, anxiety) | Map to specialty; then ask plan |
| Health plan / insurer name | `resolve_patient_plan` |
| ZIP | Rank one in-network provider; copay in context |
| Yes to contact offer | Phone + hours; **no booking** |

## Identity requirements

- Navigation resolves via **`customers.twilio_phone_number`** on `To` (overrides URL `customer_id`).
- Retell register sets `call_type=consumer_navigation`, `customer_type=navigation`.

## Telemetry

Every call emits `routing_world_resolved` in `kelly_call_events`. Ops triage: platform PSTN should show `routing_world=navigation`.

## Acceptance

- [ ] Inbound to `+13639990205` → `routing_world: navigation`
- [ ] Greeting: "How can I help you today?" (need-first)
- [ ] No `kelly_rails_v2` / OPQRST on navigation path
- [ ] No booking/slot tools on navigation line in P1
- [ ] `npm run navigation:routing-live -- --pull-db --latest` passes after PSTN call

## Related

- `docs/runbooks/NAVIGATION_OPERATOR_RUNBOOK.md`
- `docs/deployment/NAVIGATION_PITCH_SCRIPT.md`
- `services/voice-routing-world.js`
- `services/voice-account-resolution.js` — `resolveNavigationInboundByDid`
