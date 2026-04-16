# Key Rotation Schedule and Emergency Rotation Runbook

## Rotation schedule

Default cadence:

- Stripe secrets: every 90 days
- Circle API key + entity secret: every 90 days
- Internal service tokens: every 30 days

Track schedules in `secret_rotation_registry` and monitor due items from:

- `GET /api/admin/payment-ops/secrets/rotation?due_only=1`

## Standard rotation procedure

1. Create new credential in secret manager/provider.
2. Deploy app with new secret available (do not remove old yet).
3. Verify health checks and payment flows.
4. Revoke old credential.
5. Mark rotated:
   - `POST /api/admin/payment-ops/secrets/rotation/:secret_name/mark-rotated`

## Emergency rotation (suspected leak)

1. Contain:
   - Immediately revoke the suspected key/token at provider.
   - Disable affected integration route if needed.
2. Replace:
   - Provision replacement secret with new identifier.
   - Deploy quickly and verify minimal payment path.
3. Validate:
   - Check `GET /api/admin/payment-ops/alerts`
   - Check `GET /api/admin/payment-ops/secrets/abnormal-access`
4. Incident handling:
   - Follow `INCIDENT_RESPONSE.md`
   - Create postmortem from `POSTMORTEM_TEMPLATE.md`

