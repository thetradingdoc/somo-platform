# Middleware Coding Standards

This document defines quality rules for Kelly and payment stack work.

## 1) API response shape

Use a stable shape on all route responses:

- success path: `{ success: true, ...data }`
- failure path: `{ success: false, error: string, error_code?: string }`

Rules:

- `error` must be user-safe and concise.
- `error_code` should be machine-stable when available.
- Never leak raw provider payloads in API responses.

## 2) Service boundaries

- Route handlers should orchestrate request/response only.
- Domain logic belongs in `services/*`.
- Database writes should be centralized in service/database helpers, not scattered in route branches.

## 3) State machine invariants

### Kelly triage

- `opqrst_complete` indicates minimum OPQRST data captured.
- `triage_complete` indicates clinical routing readiness.
- `intake_complete_at` is enforced before booking where required, but should not cause triage deadlocks.

### Checkout and payment

- `checkout_created` != `payment_settled`.
- Verification (`/voice/checkout/verify`) is identity/authorization gate, not settlement.
- Settlement occurs only in payment processing path.

## 4) Logging conventions

Required context keys where available:

- `sessionId`
- `checkout_id`
- `appointment_id`
- `clinic_id`
- `merchant_id`

Rules:

- Use consistent component prefixes: `[KellyAgent]`, `[KellyToolExecutor]`, `[Payments]`, `[LLMRouter]`.
- Log decisions and state transitions, not just errors.
- Avoid logging PHI unless already masked.

## 5) Non-regression rules

Before merge for Kelly/payment changes:

- Run focused path tests (`back_pain_en`, `routine_en`, `billing_en` where applicable).
- Verify no API contract regressions for:
  - `/voice/appointments/checkout`
  - `/voice/checkout/verify`
  - `/process-payment`

## 6) Refactor discipline

- Prefer extraction to small helper methods over large rewrites.
- Keep behavior unchanged in cleanup-only commits.
- Separate docs/standards commits from behavior commits.
