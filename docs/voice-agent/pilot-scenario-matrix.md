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
