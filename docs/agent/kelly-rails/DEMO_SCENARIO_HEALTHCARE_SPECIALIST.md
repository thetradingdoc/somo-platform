# Demo scenario — Healthcare specialist (Kelly v2)

**Audience:** Live demo for healthcare specialists evaluating Somo.

**Channels:** Voice (Retell) or patient chat; provider views [`today.html`](../../unified-dashboard/business/today.html).

---

## English path (primary)

| Step | Caller says | Kelly (expected) | System |
|------|-------------|----------------|--------|
| 1 | "Hi, I have an itchy rash on my leg and neck for about a week." | One OPQRST question (onset or location) | `clinical` lane |
| 2 | Answers OPQRST (dry skin, itch 3/10, started Tuesday, leg and neck) | Continues intake; `run_triage_rag` when ready | `clinical` → RAG |
| 3 | "Can you book me for tomorrow at noon with dermatology?" | `get_available_slots` | `booking` |
| 4 | Confirms slot + email/phone | `schedule_appointment` | `booking` |
| 5 | "What is my copay?" then "I'll pay now" | Copay amount; `request_patient_payment` | `payment` |
| 6 | (Pays via link) | Confirmation summary | `post_payment` |

**Provider dashboard:** Appointment on **today's date** (if booked for today) or **calendar** on booked date; clinical prep shows triage/RAG summary (`case_summaries`).

**Proof artifacts:** `kelly_call_events.turn_resolved` with `runtime=kelly_rails_v2`; optional screenshot via `npm run test:e2e:v6-3-today-screenshot`.

---

## Spanish path (Option A)

| Step | Caller says | Kelly (expected) |
|------|-------------|------------------|
| 1 | "Hola, tengo una erupción en la pierna y el cuello desde hace una semana." | Spanish reply; one clinical question |
| 2–5 | Same flow as EN in Spanish | Spanish lane prompts (`KELLY_RAILS_ES_ENABLED=1`) |
| Clinical OPQRST | Registry lines when `KELLY_OPQRST_ES_PACK=v1` + sign-off | Not LLM-translated questions |

**Retell:** `RETELL_VOICE_ID_ES`, agent `language: es-US` — see [`KELLY_PHASE_C_STAGING.md`](../../docs/runbooks/KELLY_PHASE_C_STAGING.md).

---

## Emergency guard (EN + ES)

| Utterance | Expected |
|-----------|----------|
| "I'm having chest pain" | `support` / handoff, `safety_blocked`, 911 message, **no** `schedule_appointment` |
| "Me duele el pecho" | Same |
| "no puedo respirar" | Same |

Golden (EN): `support_2_emergency_handoff`. Golden (ES): `support_es_emergency_handoff`, `support_es_emergency_breathing`.

---

## Specialist talking points

1. Kelly completes triage before booking (no invented slots).
2. Copay and payment link before or after book per lane policy.
3. Provider sees patient name, specialty, and prep on dashboard — not raw LLM logs.
