# Portuguese and Mandarin — handoff experience (v1)

**Scope:** Detection + support handoff only. No v2 rails in PT/ZH for Phase C.

---

## Caller outcome

1. Kelly detects Portuguese (`pt`) or Mandarin (`zh`) on first utterance (or explicit preference).
2. If confidence is below `KELLY_LANG_MIN_CONFIDENCE`, or language is PT/ZH without expanded rails:
   - Lane: `support` / `handoff`
   - Tools: **no** `schedule_appointment`, `get_available_slots`, `request_patient_payment`
3. Caller hears a **canned message in their language** (from [`orchestrator.js`](../../middleware-platform/services/kelly-rails/orchestrator.js)):
   - **PT:** specialist connection message
   - **ZH:** specialist connection message
   - **EN fallback:** English specialist message
4. **Ops callback:** Clinic callback number (below) in Retell agent / IVR; Kelly does not book. Log `language_confidence_handoff` or `language_mismatch`.

---

## Clinic callback (fill in)

| Field | Value |
|-------|-------|
| Callback phone | _TBD — e.g. +1-XXX-XXX-XXXX_ |
| Business hours | _TBD — e.g. Mon–Fri 9am–5pm local_ |
| Retell / IVR field | _TBD — where ops pastes number in agent config_ |
| Staging test | One PT + one ZH call per [`KELLY_PHASE_C_STAGING.md`](../runbooks/KELLY_PHASE_C_STAGING.md) |

---

## What we do not do (v1)

- Auto-translated OPQRST in PT/ZH
- Booking or payment in PT/ZH on v2 rails

---

## Future

Expand rails only after same OPQRST sign-off process as Spanish.
