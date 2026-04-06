# Kelly + Payment Test Matrix (Handoff)

Use this matrix for PR validation and cross-team handoff.

## Kelly conversation matrix

| Channel | Intent Type | Expected Core Path | Must Not Happen |
|---|---|---|---|
| chat | symptom triage | OPQRST -> triage_complete -> slots -> schedule -> checkout | infinite OPQRST repeats |
| chat | routine booking | routine fast path -> slots -> schedule -> checkout | symptom triage deadlock |
| chat | billing | billing response path | forced symptom triage |
| voice | symptom triage | OPQRST -> triage_complete -> slots -> schedule -> checkout | weekend scheduling loops |
| voice | routine booking | routine fast path -> slots -> schedule -> checkout | repeated "when did it start?" |
| voice | billing | billing response path | max-turns symptom detour |

## Payment lifecycle matrix

| Stage | API | Expected Output | Required Follow-up |
|---|---|---|---|
| checkout created | `/voice/appointments/checkout` | `stage=checkout_created` and `payment_token` | verify code |
| identity verified | `/voice/checkout/verify` | `stage=identity_verified` and `next_action=process_payment` | process payment |
| action required | `/process-payment` (stripe) | `stage=payment_action_required` and `client_secret` | 3DS confirmation |
| settled wallet | `/process-payment` (wallet) | `stage=payment_settled` and `transfer_id` | finalize |
| settled stripe | `/process-payment` (stripe) | `stage=payment_settled` or `payment_authorized` | finalize/capture |

## Payment rail checks

### Wallet (Circle)
- Patient wallet exists and has sufficient balance.
- Provider wallet resolution works (clinic/merchant/env/system fallback).
- `circle_transfers` row exists.
- Checkout marked completed.

### Card (Stripe)
- PaymentIntent status handled (`requires_action`, `succeeded`, `requires_capture`).
- Checkout marked completed.
- Post-payment audit/ledger path executed.

## Minimal regression commands

- `bash scripts/run-single.sh back_pain_en`
- `bash scripts/run-single.sh routine_en`
- `bash scripts/run-single.sh billing_en`

For payment endpoint smoke tests, exercise:

- `/voice/appointments/checkout`
- `/voice/checkout/verify`
- `/process-payment`
