# Checkout State Contamination Runbook

## Purpose
Operational runbook for checkout rail incidents where users are incorrectly resumed, payment controls appear early, or rail stages rewind.

## Scope
- Public checkout-chat flow (`/api/public/checkout-chat/*`)
- Kelly tool rail (`send_commerce_verification_code`, `verify_commerce_code`, `prepare_commerce_checkout`)
- Stage sync contract (`checkout_stage`, `policy_flags`, `allowed_next_actions`)

## Fast Triage
1. Check `/api/admin/metrics` `checkout_policy` block:
   - `resume_required_count`
   - `product_switch_reset_count`
   - `prepared_transition_count`
   - `confirmed_transition_count`
   - `conversion_confirmed_over_prepared`
2. Confirm active rail guards:
   - `CHECKOUT_RAIL_GUARDS_ENABLED`
   - `CHECKOUT_STAGE_SYNC_INTENT_AWARE`
3. Inspect session meta keys in `kelly_session_meta_kv`:
   - `checkout_stage`
   - `checkout_context_version`
   - `commerce_email_verified_context_version`
   - `commerce_shipping_context_version`
   - `checkout_resume_decision`
   - `checkout_product_id`

## Incident Signatures
- **Prepared shown on learn entry**
  - `resume_required` should be `true` and `can_show_payment_form` should be `false`.
- **Stage rewind**
  - attempts to move from `checkout_prepared`/`payment_confirmed` to `code_sent`/`collecting_details` should be blocked.
- **Product switch contamination**
  - switching `product_id` with same session should force context reset.

## Recovery Actions
1. Force reset for affected session:
   - `POST /api/public/checkout-chat/reset` with `session_id`.
2. Ask user to choose:
   - Continue previous checkout OR Start over.
3. Re-check stage sync contract with:
   - `ui_mode`, `checkout_intent`, `product_id`.

## Rollout Safety
- Keep `CHECKOUT_RAIL_GUARDS_ENABLED=true` in production.
- If emergency rollback is required:
  - set `CHECKOUT_STAGE_SYNC_INTENT_AWARE=false` first (least risky),
  - avoid disabling all rail guards unless checkout is hard-down.

## Regression Checklist
- `npm run test:checkout:backend-rails`
- `npm run test:e2e-landing-kelly-stripe-parity`
- `npm run test:e2e-landing-kelly-stripe-charge-path` (strict Stripe interactive path)
