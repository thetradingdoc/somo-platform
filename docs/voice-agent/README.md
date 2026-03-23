# Voice Agent Documentation

Documentation for the Retell AI voice agent (Kelly) integration.

## 📁 Prompts

- **[Kelly Voice Agent](./prompts/kelly-voice-agent-prompt.md)** - Main system prompt
- **[Medical Voice Agent](./medical-voice-agent-prompt.md)** - Medical coding workflow (EXTRACT → TRIAGE → CODE → PRICE → VALIDATE); appended to Kelly by configure-retell.js

## 🤖 Agent Details

**Name**: Kelly  
**Platform**: Retell AI  
**Voice**: Multilingual support  
**Integration**: Twilio for phone calls  
**Functions**: Scheduling, insurance, medical coding, claims (see retell-functions.json)

## 📋 Configuration

- **Prompt**: Kelly + medical-voice-agent-prompt (combined by configure-retell.js)
- **Functions**: `middleware-platform/retell-functions/retell-functions.json`
- **Configure**: `cd middleware-platform && node configure-retell.js` (requires RETELL_API_KEY, RETELL_AGENT_ID)

## Booking Runtime Notes (Current)

- Routine/no-symptoms flow now defaults to **Primary Care** unless the patient explicitly asks for a specialist.
- Kelly must not claim a booking is confirmed until `schedule_appointment` returns success.
- Slot lookup is constrained to one date per turn to avoid repeated `get_available_slots` loops.
- Session metadata used by booking continuity:
  - `routine_no_symptoms`
  - `preferred_lane` (`sync` or `async`)
  - `preferred_date`
  - `slot_presented`
  - `last_slot_bundles`

## Debug Checklist (Scheduling)

- Confirm logs include `POST /voice/appointments/available-slots` then `POST /voice/appointments/schedule` before any "confirmed" wording.
- If Kelly re-asks urgency after email, inspect `preferred_lane` and `slot_presented` for the session.
- If slot loop appears, look for `Tool get_available_slots called ...` warnings and verify only one date is fetched per turn.

## 🔗 Related Documentation

- [Medical Coding Runbook](../architecture/voice-agent/RUNBOOK.md) - Imports, evaluation, tools
- [Tool Schemas](../architecture/voice-agent/TOOL_SCHEMAS.md) - suggest_codes_from_symptoms, extract_medical_text, etc.
- [Voice Agent Todo & Status](../architecture/voice-agent/VOICE_AGENT_TODO_AND_STATUS.md) - Integration roadmap
