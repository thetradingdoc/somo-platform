# Runbook — Replay attack attempt (webhooks / payment routes)

## Symptoms

- Sudden spike in repeated webhook event ids
- Increased “stale event outside replay window” logs
- Unexpected repeated calls to `/api/payment/*` idempotency keys

## Immediate actions

1. Confirm webhook idempotency table behavior (Stripe event ids are stored and deduped).
2. Confirm replay window `STRIPE_WEBHOOK_REPLAY_WINDOW_SEC` is enabled and reasonable.
3. Review rate limiter logs and bot-guard signals.

## Containment

- Tighten inbound rate limits temporarily.
- If necessary, rotate webhook secret and redeploy.

## Follow-up

- Open a security incident and capture timeline (`INCIDENT_RESPONSE.md`).
- Add IOCs to monitoring (IPs, user agents, event id patterns).

