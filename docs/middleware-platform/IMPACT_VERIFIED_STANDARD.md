# Verified Impact Standard (v1)

## Evidence requirements

Each impact event should include:

- `source` (who/what produced evidence)
- `reference_id` (external or internal traceable id)
- `attestation` (signed/asserted statement)
- `verification_method`

## Accepted verification methods

- `provider_attestation`
- `partner_receipt`
- `system_reconciliation`
- `manual_audit`

## Rejection criteria

- Missing required evidence fields
- Provenance inconsistency
- Duplicate claim
- Privacy policy violation

Implemented in code:
- `services/impact-ledger-service.js` (`VERIFIED_IMPACT_STANDARD`, `evaluateEvidence`)

