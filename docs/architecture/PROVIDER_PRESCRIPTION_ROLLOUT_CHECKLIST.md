# Provider/Prescription Rollout Checklist

## Pre-rollout
- [ ] Confirm route aliases mounted in target environment.
- [ ] Confirm OpenAPI shows new preferred fields.
- [ ] Confirm monitoring captures alias usage logs.

## Staged rollout
- [ ] Stage 1: Internal clients send both old + new fields.
- [ ] Stage 2: Frontend/storefront sends only new fields.
- [ ] Stage 3: External integrations migrate payloads.

## Guardrails
- [ ] Keep legacy endpoints/fields enabled during migration window.
- [ ] Add alert for checkout failure spikes.
- [ ] Add alert for auth failure spikes on products/prescriptions endpoints.

## Rollback plan
- [ ] Disable new client-side field usage (feature flag/env switch).
- [ ] Continue serving legacy responses without schema changes.
- [ ] Re-run smoke script `scripts/test-provider-prescription-aliases.js`.

## Production verification
- [ ] `GET /health` returns 200.
- [ ] `GET /api/public/prescriptions?provider_id=...` returns expected records.
- [ ] `POST /api/public/checkout/start` returns checkout payload with aliases.
- [ ] `GET /api/products` unauthenticated still returns 401.
