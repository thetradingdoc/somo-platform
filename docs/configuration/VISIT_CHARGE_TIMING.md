# Visit Charge Timing (Task 21)

Configuration for when the main visit charge occurs and how deposit holds work.

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `VISIT_CHARGE_TIMING` | `pre_auth` \| `post_capture` \| `session_end` | `post_capture` | When the visit charge is taken |
| `DEPOSIT_HOLD_ENABLED` | `1` \| `true` \| (empty) | off | Use Stripe `capture_method: 'manual'` for appointment payments |

## `VISIT_CHARGE_TIMING`

- **`pre_auth`** – Authorize at booking; capture on session start (or no-show fee)
- **`post_capture`** – Charge immediately when payment completes (default)
- **`session_end`** – Charge only after SOAP sign-off / visit completion

## `DEPOSIT_HOLD_ENABLED`

When set to `1` or `true`, Stripe Payment Intents for appointment checkouts use `capture_method: 'manual'`:

- Card is authorized (hold) at booking
- Amount is captured via `POST /api/payment/capture` when the visit starts, or cancelled via `POST /api/payment/cancel` for no-shows

## Interaction with Ledger

- **`post_capture`** – Ledger entries are settled immediately after payment
- **`pre_auth` / `DEPOSIT_HOLD_ENABLED`** – Ledger entries start as `pending` until capture

## Location

- Config module: `middleware-platform/config/visit-charge-timing.js`
- Referenced by: `/process-payment` (Stripe capture_method), ledger status
