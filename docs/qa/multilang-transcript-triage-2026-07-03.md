# Multilang transcript triage — 2026-07-03 (post phase 2)

**Backlog / pilot truth:** [money-movement-multilang-eval-backlog.md](./money-movement-multilang-eval-backlog.md) · [dental-pilot-readiness.md](./dental-pilot-readiness.md)

---

## Addendum — 2026-07-04 (phase 3: booking + EN-2)

**Strict eval:** `MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang`  
**Result:** **14/16** majority pass. Artifacts: `middleware-platform/test-results/multilang-conversation-eval/`.

### Stable PASS (3/3 majority)

| Scenario | Tag | Notes |
|----------|-----|-------|
| EN-1-booking | booking | Cyrillic/RU confirm, slot preserve, Dental routine path |
| ES-1-booking | booking | Name turn on schedule gate; `schedule_appointment_success` |
| RU-1-booking | booking | Russian confirm + slot bind |
| EN-2-cancellation | cancel | Cancel deferral + `reply-repair.js` after tool merge |
| EN-3-copay-preinquiry | copay | Unchanged |
| EN-4-general-inquiry | inquiry | Unchanged |
| ES-2-copay / ES-2-payment | copay | Unchanged |
| ES-4-inquiry-codeswitch | inquiry | Unchanged |
| RU-2-copay / RU-2-payment | copay | Unchanged |
| RU-4-inquiry | inquiry | Unchanged |
| ZH-1-fallback | inquiry | Unchanged |

### Open (0/3 — file tickets)

| Scenario | Tag | Notes |
|----------|-----|-------|
| ES-3-cancellation | cancel | Spanish reschedule pivot; may need ES-specific cancel deferral |
| RU-3-cancellation | cancel | Pure cancel + fee question; cancel deferral may block `cancel_appointment` |

### Phase 3 remediation shipped

- `reply-repair.js` — reschedule reply after executor tool merge in `kelly-turn-resolver`
- Cyrillic confirm in `confirm-utterance.js`; `passesLocalizedBookConfirm` in schedule gate
- `resolveBookingSlot` — preserve offered slot on confirmatory Tuesday/afternoon
- `cancellation-subrail` — lookup-first cancel; `move it to next week` reschedule pivot
- Dental routine `schedule_appointment` path; `APPOINTMENT_TYPES.Dental`

---

## Historical snapshot — 2026-07-03 (superseded scores below)

**Strict eval:** `CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang`  
**Evidence run:** `MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang`  
**Result:** **11/13 automated PASS** (was 6/13 post phase 1, 1/13 pre-remediation). Artifacts: `middleware-platform/test-results/multilang-conversation-eval/`.

## Majority gate (3 runs) — stable PASS

| Scenario | Tag | Majority |
|----------|-----|----------|
| EN-1-booking | **fixed** (slot meta + schedule gate confirm) | 3/3 |
| EN-2-cancellation | fixed (phase 1) | 3/3 |
| EN-3-copay-preinquiry | **fixed** (insurance gate + admin visit codes) | 3/3 |
| EN-4-general-inquiry | harness OK | 3/3 |
| ES-2-copay | **fixed** (copay_link seed + insurance gate) | 3/3 |
| ES-3-cancellation | fixed (phase 1) | 3/3 |
| ES-4-inquiry-codeswitch | fixed (phase 1; insurance acceptance guard) | 3/3 |
| RU-2-copay | **fixed** (multilingual billing + insurance gate) | 3/3 |
| RU-3-cancellation | **fixed** (Russian cancel patterns) | 3/3 |
| RU-4-inquiry | fixed (phase 1) | 3/3 |
| ZH-1-fallback | fixed (phase 1) | 3/3 |

## REVIEW — file J tickets only if product work continues

| Scenario | Tag | Notes |
|----------|-----|-------|
| ES-1-booking | product (LLM) | Family-caller Spanish booking; slots offered but `schedule_appointment` not on confirm turn (0/3) |
| RU-1-booking | product (LLM) | Russian exam booking; intake asks symptoms before slots (0/3) |

## Phase 2 remediation shipped

- **Booking:** `_persistSlotOfferMeta` after `get_available_slots`; `wantsBookConfirm` + dental specialty copy; L2/L4 `confirm_visit` promotion; RU/ES confirm patterns; ES-1/RU-1 third confirm utterance; `reason_for_visit` eval seed.
- **Copay:** Multilingual `PAY_COPAY` / `PAYMENT_SIGNALS`; insurance-first `copay_link` lane; new `gates/insurance.js`; front-desk billing bypass; harness `extends` merge + `tenant_billing` seed; admin visit code map for copay/cleaning.
- **RU cancel:** Russian stems in intent-detector, turn-planner, cancellation-subrail.

## Phase 1 remediation (unchanged)

- Harness identity/locale seed, Dental slots, reschedule redirect, ZH handoff, clinic `voice_agent_settings`.

## Stability (A7)

Require **2/3 automated majority** before opening Phase J tickets. Link `test-results/multilang-conversation-eval/<id>.json` in tickets.

**Do not file J tickets** for rows with 3/3 majority PASS above. Only **ES-1-booking** and **RU-1-booking** failed 0/3 — eligible for J tickets if prioritized.
