# Wipe tenant data (dev)

> **Last reviewed:** 2026-05-29  
> **Hygiene:** H-02

## Order (always)

External providers first — otherwise webhooks and billing keep firing for deleted rows.

1. **Stripe** — cancel subscriptions / delete test customers for tenant
2. **Twilio** — release or reassign phone numbers; clear webhooks if reusing SID
3. **Retell** — delete or unlink agent if dedicated per tenant
4. **Database** — delete tenant rows (customers → dependent tables)

## Dev script

```bash
cd middleware-platform
ALLOW_DEV_WIPE=1 node scripts/wipe-dev-tenants.cjs --customer-id=<id> --dry-run
ALLOW_DEV_WIPE=1 node scripts/wipe-dev-tenants.cjs --customer-id=<id>
```

`ALLOW_DEV_WIPE=1` is required; script refuses production `NODE_ENV`.

## Purge test accounts only

```bash
npm run db:purge-test-tenants
```

Removes smoke/trial-e2e/`@t.test` patterns without full wipe.

## Never on production

Use read-only [prod-preflight-census.md](./prod-preflight-census.md) instead. Production tenant removal needs runbook approval and provider console steps.

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](../Database/SOMO_FOUNDATION_RUNBOOK.md) — D2-01
