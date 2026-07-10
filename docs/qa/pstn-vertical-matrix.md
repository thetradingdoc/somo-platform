# PSTN vertical verification matrix (Phase 7.3)

Live PSTN scenarios per Kelly tenant vertical. Structural validation runs in CI; **real phone calls require operator execution**.

## Scenario registries

| Vertical | Registry | IDs |
|----------|----------|-----|
| dental | `e2e/scenario-registry/dental-front-desk.cjs` | DENTAL-001–011 + multilang |
| dermatology | `e2e/scenario-registry/dermatology-clinical.cjs` | DERM-001–004 |
| healthcare_clinic | `e2e/scenario-registry/healthcare-clinic.cjs` | HC-001–005 |
| small_business | `e2e/scenario-registry/small-business.cjs` | SB-001–004 |

## Commands

```bash
cd middleware-platform

# Structural gate (CI-safe)
node scripts/vertical-pstn-scenarios.cjs
node scripts/verify-pilot-scenario-matrix.cjs

# Live manifest (writes checklist — does not place calls)
VERTICAL_PSTN_LIVE=1 node scripts/vertical-pstn-scenarios.cjs
```

## Live execution (requires prod/staging access)

Set per-vertical env before placing calls:

| Env | dental | dermatology | healthcare_clinic | small_business |
|-----|--------|-------------|-------------------|----------------|
| DID | `VERTICAL_DENTAL_DID` | `VERTICAL_DERM_DID` | `VERTICAL_HC_DID` | `VERTICAL_SB_DID` |
| customer | `VERTICAL_DENTAL_CUSTOMER_ID` | `VERTICAL_DERM_CUSTOMER_ID` | `VERTICAL_HC_CUSTOMER_ID` | `VERTICAL_SB_CUSTOMER_ID` |
| clinic | `VERTICAL_DENTAL_CLINIC_ID` | `VERTICAL_DERM_CLINIC_ID` | `VERTICAL_HC_CLINIC_ID` | `VERTICAL_SB_CLINIC_ID` |

Also required: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `RETELL_API_KEY`.

### Dental (DENTAL-001–011)

Follow [pilot-scenario-matrix.md](../voice-agent/pilot-scenario-matrix.md). Example:

```bash
node scripts/dental-pstn-scenarios.cjs --scenario DENTAL-001   # HTTP replay (no PSTN)
npm run verify:live-booking-call                                # live PSTN when env set
```

### Other verticals

1. Call the bound DID for each scenario utterance sequence.
2. Record Retell `call_id` and transcript excerpt in `test-results/pstn-matrix/<vertical>/<scenario-id>.json`.
3. Mark each assertion in the scenario registry as pass/fail.

## Pass criteria

- Every scenario ID in each vertical registry has a logged live call result.
- Expected tools fired (check `kelly_call_events` via Retell or `verify-postgres-gcs-reconciliation.cjs`).
- No PHI in logs (see Phase 0.1).

**Automated in CI:** structural registry + dental HTTP replay (`dental-pstn-scenarios.cjs`).  
**Requires live prod access:** real PSTN calls for all verticals.
