# Dental pilot readiness — honest status

**Read this before any headline pass count.**

Until H5 + M1b + R2 (v3 backlog) are green, multilang PASS on payment means **token + SMS body**, not just tool fire.

## Go / no-go checklist

| Gate | Task | Status |
|------|------|--------|
| Copay SMS patient-ready | H5 | **Done** — locale SMS + harness asserts |
| `dateOfService` on collect | M1b | **Done** |
| Strict 3-run baseline | R2 | **14/16** (2026-07-04) |
| Payment link + SMS | M4/H5 | `copay_payment` **3/3** |
| Live Stedi 271 | M6 | Pending manual run |
| ES-1 / RU-1 / EN-1 booking | B1–B3 | **3/3** |
| EN-2 reschedule reply | L3b | **3/3** |

## Current blockers (strict 3-run — 2026-07-04)

| Tag | Pass rate | Notes |
|-----|-----------|-------|
| `copay_payment` | **3/3** | H5: SMS body asserted (no `undefined`, localized, copay copy) |
| `copay_eligibility` | **3/3** | L3a: localized `insurance_quote` in gate (not thin eligibility) |
| `booking` | **3/3** | EN-1, ES-1, RU-1: schedule gate + Dental routine path |
| `cancel` | 1/3 | EN-2 **3/3**; ES-3 / RU-3 still open |
| `inquiry` | 4/4 | Unchanged |

**Headline:** **14/16** automated majority pass (`MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1`).

## Prior blockers (superseded — 2026-07-03)

- Booking 0/3, EN-2 cancel-only reply 2/3 — fixed in B1–B4 / L3b workstream (2026-07-04).

## Commands

```bash
cd middleware-platform
MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang
npm run test:eval:multilang:payment
npm run test:eval:multilang:stedi-live
```
