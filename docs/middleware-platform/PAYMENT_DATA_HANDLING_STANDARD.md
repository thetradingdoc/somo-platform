# Payment Data Handling Standard

## 1) Prohibited Data

The platform must never persist or emit:
- Full PAN
- CVC/CVV/security code
- Raw magnetic stripe / track data

Allowed: Stripe `payment_intent_id`, `payment_method` references, tokenized identifiers.

## 2) Allowed Entry Paths

- Customer card data entry is allowed only through Stripe Elements/Payment Element.
- Chat and API payloads containing raw card-like data must be rejected.

## 3) Storage Contract

- Database may store checkout status, order ids, payment intent ids, totals, and minimal shipping/contact.
- No columns or JSON fields may store full card data.

### Phone numbers

- Persist customer phone as **E.164** (leading `+`, digits only after `+`, 8–15 digits). Use `utils/phone-e164.js` (`normalizeToE164`) or `SMSService.formatPhoneNumber` so inputs like `1…`, `+1…`, and `(555) …` normalize consistently before storage.

## 4) Logging Contract

- All payment/checkout logs must pass through redaction utilities.
- Logs must redact: email, phone, OTP/verification code, client_secret, payment tokens, PAN/CVC patterns.

## 5) Endpoint Controls

- Payment-mutating endpoints require strict input schema and session/intent binding checks.
- Sensitive retrieval endpoints require explicit admin/role authorization and auditability.

## 6) Release Gate

- `npm run release:security-gate` must pass before deployment.
