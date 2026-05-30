# Trial lifecycle (W4-02)

> **Last reviewed:** 2026-05-29

## States

| `trial_status` | Meaning |
|----------------|---------|
| `pending` | Signup started, phone may be unverified |
| `active` | Trial running; requires `phone_verified=1` |
| `exhausted` | Minutes/credits used up |
| `expired` | Past `trial_expires_at` |

## Sweeps

```bash
cd middleware-platform
npm run trial:expiry-sweep          # dry-run
npm run trial:expiry-sweep:apply    # apply
```

## Gates

- `phone_verified=1` required before `trial_status=active` (see `trial-lifecycle.js` `activateTrialRecord`).
- Dedicated Twilio line provisioned via `startTrialTenant`.

## Related

- [ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md)
- [SOMOPAY_SCOPE.md](../product/SOMOPAY_SCOPE.md)
