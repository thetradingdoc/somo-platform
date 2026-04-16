# Wallet key custody model and recovery procedures

## Custody model

- Circle and payment credentials are treated as high-sensitivity secrets.
- Application code reads secrets through `secret-manager` abstraction.
- Secret values are never persisted in plaintext in app tables.
- Access attempts are audited in `secret_access_audit`.

## Recovery procedures

1. Identify affected secret(s) and blast radius.
2. Execute emergency rotation from `KEY_ROTATION_AND_EMERGENCY_RUNBOOK.md`.
3. Validate critical flows:
   - payment intent success
   - refund execution
   - webhook intake
   - settlement retry
4. Review abnormal access feed:
   - `GET /api/admin/payment-ops/secrets/abnormal-access`

## Required evidence

- Rotation record updated in `secret_rotation_registry`
- Incident timeline captured in `INCIDENT_RESPONSE.md`
- Postmortem for Sev1/Sev2 incidents

