# Patient navigator pitch script (P1)

Live PSTN on **+13639990205** (`TWILIO_PHONE_NUMBER`).

## Flow (need-first)

1. Kelly: **"Hi, I'm Kelly. How can I help you today?"**
2. Caller: care need — e.g. **"my kid needs braces"**, **"I need a dentist"**, **"I've been anxious"**
3. Kelly maps need → specialty; asks: **"What health plan are you on?"**
4. Caller: **Metro Health Plus** (or Metro Plus / MHP)
5. Kelly: **"What ZIP code or neighborhood are you in?"**
6. Caller: **10001** (or any NYC ZIP)
7. Kelly: **one ranked recommendation** with copay in context — e.g. *"For braces, an orthodontist is right. On Metro Health Plus, ~$40 copay for specialist visits. Dr. Elena Rivera is in-network near you. Want their phone number and hours?"*
8. Caller: **yes** → phone + hours; call ends (no booking, no payment)

## Pass criteria

- `routing_world=navigation` on platform DID
- Need-first greeting (not plan-first)
- `resolve_patient_plan` → `ent_metro_health_plus`
- Single provider recommendation with copay context
- Contact offer only — no `get_available_slots` / booking language
- No sales QUALIFY language
- No OPQRST symptom interrogation

## Retired (do not expect)

- Plan-first benefits dump for all 4 specialties
- Provider list (up to 3) with "book with them?"
- Somo demo landing outbound calls
- `call_type=somo_demo` routing world
