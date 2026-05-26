# Security documentation

> **Last reviewed:** 2026-05-25

## Documents

| File | Topic |
|------|--------|
| [SECRET_SCANNING.md](./SECRET_SCANNING.md) | CI secret grep, recommended org-level scanning |
| [compliance README](../compliance/README.md) | Compliance index (consolidated) |
| [deployment § security](../deployment/README.md) | Production API keys, SSL, tenant setup (historical Azure sections) |

## Practices

- Never commit `.env`; use `.env.example` without real values.
- Rotate any credential that appeared in git history.
- Webhook signature validation: Stripe, Twilio, Stedi, Circle (see middleware `.env.example`).

## Related

- [CANONICAL_DOC_MAP](../meta/CANONICAL_DOC_MAP.md) — security row
- [ENVIRONMENT_VARIABLES_BY_SURFACE](../setup/ENVIRONMENT_VARIABLES_BY_SURFACE.md)
