# Runbook: Payment and Settlement Debugging

Use this when checkout appears successful but funds did not move.

## Important model

1. `checkout created` -> `verification` -> `payment processed` -> `settled`
2. The first two steps do not move money.

## API checkpoints

1. `/voice/appointments/checkout`
   - expect: `checkout_id`, `payment_token`, `requires_verification`
2. `/voice/checkout/verify`
   - expect: successful code validation
   - may include wallet balance hints
3. `/process-payment` (or `/api/payment/process`)
   - this is where settlement happens

## Wallet payment checklist

1. Circle service available.
2. Patient wallet exists and has sufficient USDC balance.
3. Provider wallet configured:
   - `CIRCLE_PROVIDER_WALLET_ID` or fallback `CIRCLE_SYSTEM_WALLET_ID`
4. `circle_transfers` row recorded.
5. Checkout status updated to `completed`.

## Card payment checklist

1. Stripe keys configured.
2. PaymentIntent succeeds.
3. Checkout marked `completed`.
4. `payment-processor-service` post-payment hooks run:
   - financial event
   - ledger transfer
   - appointment payment status update

## Common false positive

- "Verification code emailed" is not a payment success indicator.
- Treat only payment processing success as settlement.

## Quick diagnostics

1. Inspect checkout row (`voice_checkouts`) for `status`, `payment_method`, `payment_intent_id`.
2. Inspect `payment_tokens` for verification status.
3. Inspect `circle_transfers` for wallet rails.
4. Inspect logs from `[Payments]` and route-level `/process-payment`.

## Team handoff checklist

Before escalating a payment issue, include:

1. checkout id + payment token status,
2. rail used (wallet/stripe),
3. provider wallet resolution source (clinic/merchant/provider/system),
4. final lifecycle stage observed,
5. whether audit/ledger hooks executed.
