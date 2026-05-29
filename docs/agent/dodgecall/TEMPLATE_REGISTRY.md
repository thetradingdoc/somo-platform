# DodgeCall template registry

**Last updated:** 2026-05-28

Config file: [`middleware-platform/config/dodgecall-templates.json`](../../../middleware-platform/config/dodgecall-templates.json)

## Schema

```json
{
  "templates": {
    "<template_id>": {
      "persona_name": "Sam",
      "retell_agent_id_env": "DODGECALL_RETELL_AGENT_ID",
      "twilio_from_env": "DODGECALL_TWILIO_FROM_NUMBER",
      "voice_id_env": "DODGECALL_DEMO_VOICE_ID",
      "max_duration_sec": 240
    }
  },
  "use_case_map": {
    "<use_case>": "<template_id>"
  }
}
```

## v1 mapping (all personas → medical)

| Landing `use_case` | `template_id` | Notes |
|--------------------|---------------|--------|
| `receptionist` | `medical` | Default |
| `appointment_setter` | `medical` | Opener differs |
| `lead_qualification` | `medical` | Opener differs |
| `customer_service` | `medical` | Opener differs |
| `debt_collection` | `medical` | Fictional balance demo |
| `survey` | `medical` | Opener differs |

Openers live in `dodgecall-demo-service.js` (`USE_CASE_OPENERS`); registry only resolves telephony + agent + duration.

## API

`resolveTemplate({ use_case })` → `{ template_id, agentId, fromNumber, voiceId, personaName, maxDurationSec, opener }`

Resolves agent/from via `DODGECALL_*` first, then `RETELL_AGENT_ID` / `TWILIO_PHONE_NUMBER`. Throws only if none of the keys in the chain are set.
