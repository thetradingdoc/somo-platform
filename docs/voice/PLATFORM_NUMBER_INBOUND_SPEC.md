# Platform number inbound spec (PD-1)

**Status:** Draft for engineering + product sign-off  
**Epic:** PLATFORM-VOICE  
**Primary platform DID:** `+13639990205` (Twilio `TWILIO_PHONE_NUMBER` / `CALLSOMO_OPERATOR_TWILIO_NUMBER`)

## Purpose

The platform inbound line is **not** a tenant clinic DID. Callers reaching this number are prospects, operators testing, or general Somo inquiries — **not** patients of a specific clinic.

Kelly Rails clinical intake (OPQRST, `triage_sessions`, `store_triage_opqrst`) must **never** run on this line.

## Routing worlds

| World | When | Agent path | Clinical |
|-------|------|------------|----------|
| `demo` | Inbound to demo/platform DID, or `call_type=somo_demo` | `somo-demo-handler` + Groq qualification | **No** |
| `platform_support` | Operator `customer_type` on platform DID with resolved `customer_id` | Admin + handoff/callback | **No** (`triage_policy=disabled`) |
| `tenant` | Inbound to tenant DID with `customer_id` | Full Kelly Rails V2 | Per tenant policy |
| `operator_outbound` | Outbound from operator account | `operator-outbound-rail` | **No** |
| `unidentified` | No `customer_id`, not demo line | Fail-closed admin + handoff | **No** |

## Caller intents on platform inbound

| Caller says | Expected behavior |
|-------------|-------------------|
| "Can I book?" / "Make an appointment" | Demo qualification or platform handoff — **not** OPQRST |
| Email / phone capture | Contact capture — **not** SYMPTOM |
| "What do you do?" / "Speak to someone" | Handoff + `record_interest` (demo) or callback offer |
| Real symptom on platform line | Demo VALUE illustration only — no `triage_sessions` writes |

## Identity requirements

- `tenantResolved` = **`customer_id` present** (clinic_id alone is insufficient).
- Env `DEFAULT_CLINIC_ID` fallback applies **only** when `customer_id` is resolved.
- Retell register must set `dynamicVariables.call_type`, `customer_id`, `direction`, `to_number`.

## Telemetry

Every call emits `routing_world_resolved` in `kelly_call_events`. Ops triage: if OPQRST fires, check `routing_world !== tenant`.

## Acceptance (PD-4)

- [ ] Platform inbound → `routing_world: demo` in events
- [ ] No `kelly_rails_v2` / OPQRST on demo path
- [ ] Replay `call_de149e6` / `call_affe468` utterances pass unit smoke
- [ ] Tenant DID with `customer_id` → full Kelly booking/clinical per policy

## Related

- `todos/PLATFORM-VOICE-ROUTING.md` — implementation tracker
- `docs/runbooks/OPERATIONS.md` — number map (PD-3)
- `services/voice-routing-world.js` — code SSOT
