# OPQRST Spanish sign-off template (C-P0-02)

**Status:** Awaiting clinical review — do not populate `es.json` until signed.

**Related:** [KELLY_PHASE_C_STAGING.md](../runbooks/KELLY_PHASE_C_STAGING.md) · R-09

---

## Review packet

| Field | EN (approved) | ES (draft — clinical fill) |
|-------|---------------|----------------------------|
| Onset prompt | | |
| Provocation prompt | | |
| Quality prompt | | |
| Radiation prompt | | |
| Severity prompt | | |
| Timing prompt | | |
| Associated symptoms | | |
| Emergency handoff | | |

## Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| Clinical lead | | | ☐ |
| Product | | | ☐ |

## Cohort plan (operator)

- 10 staging ES calls — OPQRST complete
- 5 re-prompt / clarification cases
- 5 handoff / escalation cases

**Gate:** `KELLY_RAILS_ES_ENABLED=1` in prod only after sign-off row above is checked.
