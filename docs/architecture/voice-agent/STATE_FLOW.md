# Medical Coding Voice Agent – State Flow

State machine for the medical coding voice agent. Implemented in `coding-state-service.js`, persisted via `retell-websocket.js`.

## Stages

| Stage | Description |
|-------|-------------|
| INTAKE | Call start; collecting patient info, scheduling |
| EXTRACTION | User described symptoms; extracting entities |
| TRIAGE | Assessing urgency (EMERGENT/URGENT/ROUTINE) |
| CODING | Searching ICD-10/CPT/HCPCS |
| VALIDATION | Validating code pairs, checking guidelines |
| BILLING | Insurance, pricing, checkout |

## Transitions

- **First user utterance**: INTAKE → EXTRACTION
- **assess_urgency**: → TRIAGE
- **search_icd10_codes / search_cpt_codes / search_hcpcs_codes**: → CODING (then auto → VALIDATION after completion)
- **validate_code_pair**: → VALIDATION
- **collect_insurance / get_code_pricing**: → BILLING
- **schedule_appointment, get_available_slots, etc.**: stay in INTAKE

Stages only advance forward (or to BILLING); no backwards transitions.

## Persistence

- **voice_call_states**: current_stage, state_data per call
- **voice_conversation_memory**: turn_number, role, content per turn
- **agent_state_snapshots**: stage transition snapshots for audit

## Cleanup

```bash
node scripts/cleanup-voice-call-state.js [days]
```

Default: 30 days retention.

## Monitoring

| Source | Data |
|--------|------|
| **function_call_log** | function_name, response_time_ms, success, call_id |
| **voice_call_log** | twilio_cost_usd, retell_cost_usd, total_cost_usd, call_duration_minutes |
| **coding_decisions** | proposed_icd10, proposed_cpt, validation_status per validate_code_pair |
| **agent_state_snapshots** | stage transitions, function results |

Costs fetched from Twilio/Retell APIs on call end; fallback to calculated estimates.
