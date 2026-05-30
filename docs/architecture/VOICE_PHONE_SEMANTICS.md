# ADR: Voice phone field semantics

**Status:** Accepted  
**Date:** 2026-05-29  
**Context:** Somo SaaS tenants have multiple phone-related columns; conflating them breaks trial gating, Twilio routing, and support debugging.

## Decision

| Field | Semantics |
|-------|-----------|
| `customers.phone_number` | **Contact phone** — OTP, account recovery, `phone_verified` trial gate |
| `customers.twilio_phone_number` | **Inbound voice DID** — what callers dial; drives `/voice/incoming` |
| `customers.twilio_phone_sid` | Twilio resource id for webhook/API updates |
| `clinic_phone_numbers` | Optional many-to-one routing table per `clinic_id` |

Contact and inbound **may differ** on the same customer. Document both in ops handoffs.

## Consequences

- Attach/provision scripts must set `twilio_phone_number` + SID, not only `phone_number`.
- `trial_status=active` requires `phone_verified=1` on the **contact** number (W2-09).
- Twilio webhooks should include `customer_id` when multiple tenants share infrastructure patterns.

## Related

- [PHONE_NUMBERS.md](../Database/PHONE_NUMBERS.md)
- [SOMO_FOUNDATION_RUNBOOK.md](../Database/SOMO_FOUNDATION_RUNBOOK.md)
