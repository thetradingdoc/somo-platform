# Privacy Hardening Checklist

Owner: Security + Platform Engineering  
Scope: Checkout, payment, and sensitive data handling

## Batch 1 (Runtime Enforcement)

| Control | Owner | Status | Evidence |
|---|---|---|---|
| PAN/CVC prohibited in checkout APIs | Platform | Implemented | `utils/payment-input-policy.js`, `routes/public-commerce-cart.js` |
| Chat blocks card/CVV entry with deterministic guidance | Platform | Implemented | `server.js` `_looksLikeCardOrCvv` gate |
| Prevent stage rewind during in-flight/confirmed payment | Platform | Implemented | `services/kelly-tool-executor.js` `_setCheckoutStage` rewind guard |
| Virtual card details endpoint admin-gated | Security | Implemented | `server.js` `/api/patient/cards/:cardId` + `requireAdminAuth` |
| Session/intent mismatch guard on confirm-payment | Platform | Implemented | `routes/public-commerce-cart.js` `payment_intent_session_mismatch` |
| Startup strict security for critical secrets in production | Platform | Implemented | `utils/env-validator.js` (`STRICT_SECURITY_STARTUP`) |

## Batch 2 (Governance, Testing, Release Gate)

| Control | Owner | Status | Evidence |
|---|---|---|---|
| Tokenize-only payment contract | Platform | Implemented | `utils/payment-input-policy.js` |
| Redaction guarantees test suite | Security | Implemented | `__tests__/security.redaction.test.cjs` |
| CI forbidden data scan | Security | Implemented | `scripts/security-scan-forbidden-data.cjs` |
| Release security gate script | Platform | Implemented | `package.json` `release:security-gate` |
| Payment data handling standard | Security | Implemented | `docs/PAYMENT_DATA_HANDLING_STANDARD.md` |
| Endpoint auth/sensitivity inventory | Security | Implemented | `docs/ENDPOINT_SENSITIVITY_INVENTORY.md` |
| Incident response playbook | Security | Implemented | `docs/PAYMENT_DATA_INCIDENT_PLAYBOOK.md` |
| Pre-deploy security checklist | Platform | Implemented | `docs/PREDEPLOY_SECURITY_CHECKLIST.md` |

## Mandatory Policy Statements

- Never store PAN/CVC in DB/logs/traces/events/queues.
- Stripe Elements is the only customer card entry mechanism.
- Backend accepts tokenized payment identifiers only.
- Sensitive logs must be redacted at source.
- Payment-sensitive endpoints must be authenticated/authorized and tenant-scoped.
