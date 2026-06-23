# CR-001–005 — Operator production gates

One-command automated check plus manual steps for Kelly Rails V2 enforcement on live Cloud Run.

## Prerequisites

- `gcloud` authenticated with access to `somo-middleware` (prod or staging)
- Optional: `GCP_PROJECT`, `GCP_SERVICE`, `GCP_REGION` overrides

## Automated gate (CR-001, CR-002, CR-004)

```bash
# From repo root
npm run operator:cr-001-005

# Or from middleware-platform
GCP_PROJECT=somo-callsomo npm run operator:cr-001-005
```

This runs `verify:kelly-rails-cloudrun`, asserts required env vars, and writes evidence to `middleware-platform/var/evidence/cr-001-005/<timestamp>.json`.

### Expected production values

| Variable | Required value | Ticket |
|----------|----------------|--------|
| `KELLY_RAILS_V2` | `1` | CR-004 |
| `KELLY_RAILS_ROLLOUT_PCT` | `1` | CR-004 |
| `KELLY_ALLOW_HYBRID_GRAPH` | `0` or unset | CR-004 |
| `CONVERSATION_MODE_ROUTING` | `enforce` (not `shadow`) | CR-002 |
| `OPQRST_FIELD_GATE_ENABLED` | `1` or unset | — |

## Manual step — CR-003 (tenant inbound admin enforce)

**Do not enable until 48h clean shadow telemetry.**

1. Confirm Cloud Logging shows no `conversation_mode_shadow` mismatches for inbound admin calls.
2. Set `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN=1` via `generate-cloudrun-env-yaml.cjs` (production profile).
3. Redeploy: `npm run callsomo:deploy-api` or `./scripts/deploy-to-gcp.sh`.
4. Re-run `npm run operator:cr-001-005` and record new evidence JSON.

Rollback: set `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN=0` and redeploy (<15 min). See [`CONVERSATION_MODE_ROLLOUT.md`](./CONVERSATION_MODE_ROLLOUT.md).

## CR-005 — Deploy guard

`callsomo-terminal-cutover.sh deploy-api` runs `verify:kelly-rails-cloudrun` and **fails the deploy** if routing is still `shadow`. No separate operator action unless bypassing that script.

## Evidence archive

After each successful run, commit or attach the JSON from `var/evidence/cr-001-005/` to the deploy ticket. Minimum fields: `revision`, `env` snapshot, `passed`, `timestamp`.

## Related

- [`docs/deployment/OPERATIONS.md`](../deployment/OPERATIONS.md#kelly-cloud-run-env-snapshot-cr-00104)
- [`todos/PENDING.md`](../../todos/PENDING.md) — CR-001 through CR-005
