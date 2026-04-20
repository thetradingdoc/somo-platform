# Voice Agent Documentation

**Last Updated:** April 9, 2026

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

## Routine vs Symptom Flow (How Each Path Works)

| Step | **Routine (no symptoms)** | **Symptom flow** |
|------|---------------------------|------------------|
| Intent | "General visit", "routine checkup", "no symptoms" | User describes symptoms (pain, rash, etc.) |
| Triage | Skipped. `routine_no_symptoms` flag set in session meta. | OPQRST + `run_triage_rag` → triage_sessions + triage_rag_results |
| Slots | `get_available_slots` allowed via routine bypass (no RAG required). Defaults to Primary Care. | `get_available_slots` requires triage_complete + RAG result. Specialty from triage. |
| Schedule | `schedule_appointment` allowed via routine bypass when `routine_no_symptoms` is set. No triage row needed. | `schedule_appointment` requires triage_sessions row, triage_complete, OPQRST, intake_complete_at, RAG. |

**Why both paths exist:** Symptom flow ensures clinical safety (OPQRST, differential, confidence) before booking. Routine flow avoids unnecessary triage for wellness visits with no symptoms.

**Common failure:** If `routine_no_symptoms` is never set (e.g. typo in "none" → "non3"), the system falls back to symptom requirements. Schedule then fails with TRIAGE_REQUIRED and the LLM may hallucinate confirmation. Typo-tolerant pattern matching and LLM-trust recovery fix this.

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
- If schedule fails with `TRIAGE_REQUIRED` / `TRIAGE_INCOMPLETE` on a routine visit, check `routine_no_symptoms` in session meta. Routine bypass only applies when this flag is set.

## 🔗 Related Documentation

- [Medical Coding Runbook](../architecture/README.md#voice-agent-runbook) - Imports, evaluation, tools
- [Tool Schemas](../architecture/README.md#voice-agent-tool-schemas) - suggest_codes_from_symptoms, extract_medical_text, etc.
- [Voice Agent Todo & Status](../architecture/README.md#voice-agent-voice-agent-todo-and-status) - Integration roadmap
