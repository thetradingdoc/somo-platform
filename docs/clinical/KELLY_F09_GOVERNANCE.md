# F-09 Clinical governance (Gov-06 / Gov-04)

**Purpose:** Single registry for Kelly Phase C clinical sign-off ownership. Referenced from [KELLY_CODING_MASTER_EXECUTION_PLAN.md](../Medical%20Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md) Appendix C and [`todos/PENDING.md`](../../todos/PENDING.md) CF-OP-5 / CF-OP-8.

**Assigned:** 2026-07-10 (Gov-06 registry established)

---

## RACI

| Role | Name | Email | Notes |
|------|------|-------|-------|
| **Accountable** (product owner) | Jay | — | Escalation for unsigned F-09 by Week 4 |
| **Responsible** (clinical lead) | *Product to assign* | — | **CF-OP-8** — fill before Appendix C handoff (Week 1) |
| **Consulted** | Engineering | — | Spine, ranking, HITL |
| **Informed** | Operator | — | D-01 / K-02 closeout |

---

## Handoff package (Appendix C)

When clinical lead is named, deliver:

1. [Appendix C — F-09 sign-off](../Medical%20Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md#appendix-c--f-09-kelly-phase-c-clinical-sign-off)
2. [KELLY_PHASE_C_STAGING.md](../runbooks/KELLY_PHASE_C_STAGING.md)
3. [OPQRST_ES_SIGNOFF_TEMPLATE.md](./OPQRST_ES_SIGNOFF_TEMPLATE.md)
4. Prior ship sign-off: [OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md](./OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md)

---

## Assignment log

| Date | Action | By |
|------|--------|-----|
| 2026-07-11 | D-01 Cloud Run env verified (`verify-pinecone-deploy-env --cloudrun`); prod snapshot sign-off pending | eng/ops |
| 2026-07-11 | K-02 nightly log scaffolded at `var/evidence/k02-nightly-log.json` — 7-night count not started | ops |

*Product: update **Responsible** row when clinical lead is named, then check CF-OP-8 in PENDING.md.*
