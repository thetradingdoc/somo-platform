# Payment Data Incident Playbook

## Trigger Conditions

- PAN/CVC pattern detected in logs/artifacts.
- Token/client secret exposed in public logs or traces.
- Unauthorized access to sensitive payment endpoints.

## Immediate Containment (0-30 min)

1. Freeze deploys to affected service.
2. Rotate impacted secrets (Stripe/LangSmith/email providers if exposed).
3. Disable affected endpoint/feature flag where possible.
4. Snapshot and preserve forensic logs.

## Investigation (30-180 min)

1. Identify data classes exposed (PAN/CVC/token/email/OTP).
2. Scope impacted systems and time window.
3. Identify root cause path (endpoint, logger, queue, test artifact).
4. Validate whether external access occurred.

## Remediation

1. Patch code path and add regression tests.
2. Run `release:security-gate`.
3. Backfill redaction/purge for leaked artifacts where possible.
4. Document incident timeline and preventive controls.

## Communication

- Security lead approves stakeholder updates.
- Compliance/legal notified if regulated data exposure is confirmed.
