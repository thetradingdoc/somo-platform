# Checkout UX QA Checklist

Use this checklist for quick manual verification of chat checkout UX across desktop and mobile widths.  
See also: `CHECKOUT_CHAT_UI_NOTES.md`.

## Required States

- [ ] `Cart` step renders with correct item count and subtotal.
- [ ] `Shipping` step appears after email capture / code send.
- [ ] `Payment` step appears after `checkout_prepared`.
- [ ] `Confirm` step appears after successful payment (server stage `payment_confirmed` maps to **Confirm** in the dock; there is no separate “delivery” step in the UI).

## Layout

- [ ] Cart/checkout block scrolls **with** the chat thread (user can scroll it up to read earlier messages).
- [ ] Main column scroll feels natural on mobile (no tiny fixed chat viewport).

## Verification UX

- [ ] No duplicate OTP prompts after chat verification succeeds.
- [ ] Payment panel does not show secondary `Send code / Verify` controls.
- [ ] Verified users are prompted with a button CTA to continue (no phrase loop dependency).
- [ ] If shipping was already captured, user is not asked for shipping again.

## Payment Panel UX

- [ ] Billing labels are clear (`Billing street address`, card section includes CVC wording).
- [ ] Stripe payment element is visible and clickable.
- [ ] Card/CVC fields accept focus and input.
- [ ] Pay button is disabled during in-flight payment to block duplicate submit.
- [ ] Cancel control does not overlap payment controls.

## Post-payment (security + clarity)

- [ ] After success, **billing/card inputs are gone** (replaced by a short “Payment complete” notice—not editable fields).
- [ ] Receipt bubble appears with total, email, and order reference where applicable.
- [ ] Composer placeholder after payment is helpful (e.g. questions about the order), not a fake “status” string.

## Totals and Consistency

- [ ] CTA amount matches cart subtotal.
- [ ] Receipt amount matches charged subtotal.
- [ ] Cart/chat/panel totals are consistent across the flow.

## Failure/Recovery UX

- [ ] Payment failure shows retry-safe guidance.
- [ ] Retry uses checkout continuation (no verification rewind).
- [ ] Confirmed state shows receipt/order reference.

## Screenshots to Capture

- [ ] Cart step (subtotal visible)
- [ ] Shipping step (verification guidance)
- [ ] Payment step (Stripe field visible)
- [ ] Confirm step (post-payment state + receipt)
- [ ] Failure state (retry guidance)
