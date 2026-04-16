# Runbook — Stripe webhook failures

## Symptoms

- `GET /api/admin/payment-ops/alerts` includes `stripe_webhook_failures`
- Stripe dashboard shows webhook delivery failures or signature errors
- `stripe_webhook_events.status='failed'` rows increasing

## Immediate actions (10 minutes)

1. Confirm the webhook endpoint is reachable (deploy health).
2. Check `STRIPE_WEBHOOK_SECRET` is set and correct.
3. Look for signature verification failures in logs.
4. If failures are due to transient processor delay, **do not** disable webhooks; Stripe will retry.

## Investigation checklist

- Identify failing event types in `stripe_webhook_events.event_type`.
- Verify replay window config `STRIPE_WEBHOOK_REPLAY_WINDOW_SEC` isn’t rejecting legitimate events.
- Confirm raw-body middleware ordering is correct (must mount stripe webhook router before `express.json()`).

## Recovery

- Fix configuration/deploy issue.
- Let Stripe retry naturally.
- If gaps exist, use Stripe dashboard to re-send recent events.

## Escalation

- If sustained failures > 30 minutes or payments are stuck: escalate to **Payments on-call** per `ONCALL_AND_ESCALATION.md`.

