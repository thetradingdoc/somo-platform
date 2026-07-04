# Pilot scenario matrix — NYC dental front desk

Maps **Craigslist job-post intents** to automated **HTTP replay** scenarios (`dental-pstn-scenarios.cjs`) and live PSTN proof commands.

## Run matrix (dev / CI)

```bash
cd middleware-platform
npm run verify:pilot-scenario-matrix   # structural + doc parity
node scripts/dental-pstn-scenarios.cjs # full HTTP replay (simulated Stedi)
node scripts/dental-pstn-scenarios.cjs --scenario DENTAL-003 --json
```

Env for replay: `VOICE_ELIGIBILITY_SIMULATE=1`, `KELLY_RAILS_V2=1`, `KELLY_RAILS_ROLLOUT_PCT=1`.

## Ring 3 money-path gates

```bash
npm run test:rcm:money-path          # Jest gates (quote, identity, settlement)
npm run verify:rcm-money-path          # Jest + dental-copay + dental-pstn scenarios
npm run test:eval:multilang:smoke      # EN-1 conversation smoke (LLM)
```

### Run cadence and cost guardrails

| Tier | When | Command | Approx. LLM cost |
|------|------|---------|------------------|
| PR / fast | Every push | `test:rcm:money-path` + structural PSTN (`DENTAL_PSTN_STRUCTURAL=1`) + `test:eval:multilang:smoke` | ~1 scenario |
| Nightly | Scheduled | `CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang` (13 scenarios) | ~13+ calls |
| Local iterative | Dev only | `--scenario=`, `--lang=`, `--intent=copay` | Subset only |
| Pre-ticket evidence | Before product tickets | `MULTILANG_EVAL_RUNS=3 npm run test:eval:multilang` | Bounded retries; 2/3 majority |

`RCM_MONEY_STRICT=1` gates money-path Jest only. `CONVERSATION_EVAL_STRICT=1` gates multilang harness (tools + disclosure + disposition + PHI). Do not conflate the two flags.

Scenario registry: `e2e/scenario-registry/dental-front-desk.cjs` (DENTAL-001–011 + multilang EN/ES/RU/ZH).

## Scenario map

| Craigslist intent | Scenario ID | Title | Expected tools | Live PSTN proof |
|-------------------|-------------|-------|----------------|-----------------|
| New patient booking / cleaning | `DENTAL-001` | New patient — cleaning (D1110) | `schedule_appointment` | `npm run verify:live-booking-call` |
| Insurance verify + member ID | `DENTAL-002` | Returning patient — Delta Dental | `collect_insurance` | `npm run verify:live-copay-call` |
| Copay quote + collect payment | `DENTAL-003` | Copay quote + SMS pay link | `collect_insurance`, `request_patient_payment` | `npm run verify:live-copay-call` |
| Self-pay / no insurance | `DENTAL-004` | Self-pay fallback | `request_patient_payment` | Pay link smoke on staging |
| Russian bilingual front desk | `DENTAL-005` | Russian bilingual greeting | `schedule_appointment` | Manual PSTN — Russian opener |
| After-hours / coverage mode | `DENTAL-006` | After-hours handoff | `transfer_call` | Call outside office hours |
| Wrong office / boundary | `DENTAL-007` | Wrong office — polite boundary | (none) | Ad-hoc PSTN wrong-number |
| Family caller booking | `DENTAL-008` | Family caller — spouse | `schedule_appointment` | Manual PSTN family intake |
| Stedi down / eligibility timeout | `DENTAL-009` | Stedi timeout — desk callback | `collect_insurance` | Toggle `STEDI_CB` or prod outage drill |
| Speak to front desk | `DENTAL-010` | Transfer to front desk | `transfer_call` | `npm run verify:live-call` (handoff) |
| `DENTAL-011` | Spanish bilingual — cleaning | `schedule_appointment` | Manual PSTN — Spanish opener |

## Golden loop (end-to-end)

1. **DENTAL-001** — book appointment → Somo calendar row
2. **DENTAL-002/003** — eligibility → copay quote → pay link
3. Dashboard — Today / Calls show disposition + eligibility + copay

Structural gate: `npm run verify:phase2-golden-loop`

## Assertions glossary

| Assertion | Meaning |
|-----------|---------|
| `FRONT_DESK_INTAKE` | Kelly captures visit reason without clinical overreach |
| `BOOKING_OFFER` | Offers schedulable slots |
| `PAYER_COLLECT` | Collects payer + member ID safely |
| `NO_PHI_LEAK` | No member ID / DOB echoed in unsafe logs |
| `COPAY_QUOTE` | Speaks or prepares copay amount |
| `PAYMENT_LINK` | SMS pay link tool fired |
| `STEDI_DOWN_HANDOFF` | Fail-closed to desk when Stedi unavailable |
| `WARM_TRANSFER` | Transfer tool with reason |

## Related

- [PILOT_INCIDENT_PLAYBOOK.md](./PILOT_INCIDENT_PLAYBOOK.md)
- [PILOT_ONCALL_WEEK.md](./PILOT_ONCALL_WEEK.md)
- [phase2-pilot-checklist.md](./phase2-pilot-checklist.md)
