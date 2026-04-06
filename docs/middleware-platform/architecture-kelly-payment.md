# Kelly + Payment Architecture

This document summarizes the current end-to-end architecture.

## Kelly flow (current)

1. `KellyAgentService.processTurn()` performs:
   - emergency pre-check
   - fast intent check (billing/routine)
   - LLM loop with tool calls
2. `KellyToolExecutor` executes tool calls:
   - triage (`store_triage_opqrst`, `store_triage_rich_intake`, `run_triage_rag`)
   - booking (`get_available_slots`, `schedule_appointment`)
   - checkout (`create_appointment_checkout`, `verify_checkout_code`)
3. Triage state is persisted in `triage_sessions` and `triage_rag_results`.

## Payment flow (current)

1. `/voice/appointments/checkout`:
   - creates `voice_checkouts` row
   - creates `payment_tokens` row
   - sends verification code/email
2. `/voice/checkout/verify`:
   - validates token + code
   - returns wallet availability hints
   - does not settle funds
3. `/process-payment` (or `/api/payment/process`) performs settlement:
   - wallet path: Circle transfer
   - card path: Stripe PaymentIntent
   - then marks checkout paid and records audit/ledger via `payment-processor-service`

## Key distinction

- Checkout created and verified means "ready to pay".
- Money movement happens only in payment processing route.

## Data ownership

- Conversation and triage:
  - `kelly_conversation_history`
  - `triage_sessions`
  - `triage_rag_results`
- Booking:
  - `appointments`
- Checkout/payment:
  - `voice_checkouts`
  - `payment_tokens`
  - `circle_transfers`
  - financial/ledger records

## Known architectural risks

1. Flow drift: verify step can be treated as completion by callers.
2. Provider wallet dependency: wallet settlement requires provider wallet config.
3. Mixed route responsibilities: some payment logic is still heavy in `server.js`.
