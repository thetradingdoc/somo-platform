# Log and Export Redaction Standards

## Never log

- Full card numbers, CVV, full API keys, raw bearer tokens
- Full SSN or full date-of-birth
- Full clinical notes in public/ops logs

## Allowed with masking

- Email: keep first 2 + domain, mask rest
- Phone: keep last 4 only
- Token/key: first 4 + last 2 only

## Analytics/export controls

- Public exports must use aggregate-only metrics.
- Any row-level export containing PII requires admin-security approval.
- PHI fields must be removed or irreversibly anonymized.

