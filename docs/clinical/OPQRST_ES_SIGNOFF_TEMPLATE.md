# OPQRST Spanish pack — clinical sign-off template

Copy this file to `OPQRST_ES_SIGNOFF_<YYYY-MM-DD>.md` when review is complete.

## Pack under review

- File: `middleware-platform/config/clinical-opqrst/es.json`
- English reference: `middleware-platform/config/clinical-opqrst/en.json`
- Gate flag: `OPQRST_FIELD_GATE_ENABLED=1`

## Reviewer

| Field | Value |
|-------|-------|
| Reviewer name | |
| Role (MD / RN / clinical lead) | |
| Date | |
| Environment verified (staging / prod) | |

## Checklist

- [ ] All `questions.*.text` reviewed — no machine translation in prod copy
- [ ] `voice_max_words` appropriate for spoken Spanish (Retell TTS)
- [ ] Safety questions (`safety_q1`, `safety_q2`) approved per protocol
- [ ] `specialty_notes` reviewed for dermatology / cardiology / psychiatry
- [ ] Staging voice cohort: `npm run verify:kelly-phase-c-bundle --prefix middleware-platform`
- [ ] Spanish live scorecard (optional): 10 happy-path calls per runbook

## Sign-off

I approve the Spanish OPQRST field-gate copy in `es.json` for production use.

Signature / initials: _______________

## Related

- [`docs/runbooks/KELLY_PHASE_C_STAGING.md`](../runbooks/KELLY_PHASE_C_STAGING.md)
- [`docs/clinical/OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md`](./OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md) (EN ship record)
