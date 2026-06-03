# OPQRST review packet v1 (English source)

**For:** Medical translator — clinical intent review, not literal machine translation.

**Source files:**
- [`docs/voice-agent/prompts/kelly-voice-agent-prompt.md`](../voice-agent/prompts/kelly-voice-agent-prompt.md) — OPQRST section, specialty deep-dives, safety screen
- [`middleware-platform/services/kelly-prompt-builder.js`](../../middleware-platform/services/kelly-prompt-builder.js) — `buildTriagePhasePrompt`

**Enabled languages v1:** `en` (live), `es` (after sign-off). `pt`, `zh` → handoff only.

---

## Voice rules (include in every language)

- One OPQRST field per turn on voice (~20 words max).
- Do not read a checklist; adapt naturally.
- Emergency: stop booking; direct to 911 / local emergency.

---

## Core OPQRST (order)

| ID | Field | English prompt (review for ES) | Clinical intent |
|----|-------|-------------------------------|-----------------|
| opqrst_onset | Onset | When did this start? | Establish timeline |
| opqrst_provocation | Provocation/Palliation | What makes it better or worse? | Triggers/relief |
| opqrst_quality | Quality | What does it feel like? (sharp, burning, itchy…) | Characterize symptom |
| opqrst_radiation | Radiation | Does it spread anywhere? | Spread (skip psychiatry) |
| opqrst_severity | Severity | On a scale of 1 to 10, how bad is it? | Severity; ≥8 urgent |
| opqrst_timing | Timing | Is it constant or does it come and go? | Pattern |

---

## Safety screen (Columbia — psychiatry / MH differential)

| ID | English | Intent |
|----|---------|--------|
| safety_q1 | In the past month, have you wished you were dead? | Suicide risk |
| safety_q2 | Have you had thoughts of killing yourself? | Suicide risk |

Positive → crisis resources; no booking.

---

## Specialty deep-dive (all blocks in voice prompt — translate for v1)

Review and translate **all** specialty sections in `kelly-voice-agent-prompt.md`:

- Hepatology/GI (alcohol, liver tests)
- Cardiology (family heart disease, ECG)
- Dermatology (duration, spreading, products)
- Psychiatry (PHQ-2, GAD-2, safety; no radiation question)
- Orthopedics (mechanism, prior treatment)
- Non-pain adaptations (rash, fatigue, respiratory, psychiatry)

---

## Deliverables from translator

1. Spanish text per `question_id` matching registry schema in `middleware-platform/config/clinical-opqrst/es.json`
2. List of ambiguous phrases flagged
3. Sign-off file `OPQRST_ES_SIGNOFF_<date>.md`
