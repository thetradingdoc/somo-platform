# Stripe Webhook Paths

Canonical webhook path:
- `POST /webhooks/stripe` (mounted from `routes/stripe-webhook-handler`)

Legacy path:
- `POST /webhook/stripe`
- Disabled by default and returns `410` unless `ALLOW_LEGACY_STRIPE_WEBHOOK=1`.
- Kept only for controlled backward compatibility.

Related webhook:
- `POST /webhooks/stripe/issuing` for card issuing events.

Operational policy:
- Configure Stripe Dashboard to send payment events to `/webhooks/stripe`.
- Do not configure `/webhook/stripe` for new environments.
- Keep `STRIPE_WEBHOOK_SECRET` aligned with the endpoint secret used by `/webhooks/stripe`.

