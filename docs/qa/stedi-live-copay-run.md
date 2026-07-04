# Live Stedi copay eval — runbook

Pre-pilot gate: prove eligibility returns a real quote, not simulate-only.

## Prerequisites

- `STEDI_API_KEY` configured
- `STEDI_TEST_MODE=1`
- `VOICE_ELIGIBILITY_SIMULATE=0`
- Test payer/member fixtures on pilot clinic (`TEST_CLINIC_ID` or `PHASE2_PILOT_CLINIC_ID`)
- LLM API key for conversation driver

## Run

```bash
cd middleware-platform
npm run test:eval:multilang:stedi-live
```

Also run eligibility-only for comparison:

```bash
VOICE_ELIGIBILITY_SIMULATE=0 STEDI_TEST_MODE=1 \
  node scripts/kelly-multilang-conversation-eval.cjs --scenario=EN-3-copay-preinquiry
```

## Record outcomes

For each scenario, classify from transcript + `eligibility_checks` row:

| Outcome | Meaning |
|---------|---------|
| `hard_copay` | 271 returned finite copay; dollar in reply |
| `thin` | Eligibility OK but no hard copay |
| `inactive` | Member/plan inactive in Stedi test |

Save artifact: `test-results/multilang-conversation-eval/<scenario-id>.json`

## Go / no-go

**Go:** At least one fixture returns `hard_copay` end-to-end on EN-3-payment (collect + spoken quote + pay link if identity verified).

**No-go:** All fixtures `inactive` or `thin` — file separate Stedi fixture ticket; do not treat simulate PASS as pilot-ready.

## M1 simulate semantics (Option A)

When `VOICE_ELIGIBILITY_SIMULATE=1`, eligibility uses deterministic mock copays only — no Stedi-first probe. Production voice must keep `VOICE_ELIGIBILITY_SIMULATE=0`.

## Template (fill after run)

| Scenario | Eligibility quality | Quote spoken | Payment link |
|----------|---------------------|--------------|--------------|
| EN-3-copay-preinquiry | | | n/a |
| EN-3-payment | | | |

**Decision:** **go (simulate + SMS)** for Ring 3 payment path; **blocked (live Stedi)** until `test:eval:multilang:stedi-live` run with `VOICE_ELIGIBILITY_SIMULATE=0`.

**M1b (2026-07-04):** Direct-tools `/insurance/collect` now defaults `dateOfService` to today — prerequisite for live Stedi. Re-run this suite before pilot go/no-go.

**H5 SMS (2026-07-04):** Copay payment SMS uses `formatCopayPaymentSms` (EN/ES/RU). Eval asserts `sms_body` on `payment_link_sent` — no `undefined`, no "Complete your order". Example EN: `E2E Dental Clinic: Your estimated copay is $25.00. Pay securely: …`

**Post-M4 simulate run (2026-07-03):**

| Scenario | Eligibility quality | Quote spoken | Payment link |
|----------|---------------------|--------------|--------------|
| EN-3-copay-preinquiry | hard_copay ($25 simulate) | Yes | n/a |
| EN-3-payment | hard_copay | Yes ($25) | Yes — `request_patient_payment` |
| ES-2-payment | hard_copay | Yes ($20 Delta→BCBS mock) | Yes |
| RU-2-payment | hard_copay | Yes ($30 MetLife→UHC mock) | Yes |

**Notes:** `RCM_E2E_DIRECT_TOOLS=1` now calls real `InsuranceService.checkEligibility` in `postDirect` (was stub returning $0). Twilio SMS may fail on +1555 test phones — pay token still asserted.
