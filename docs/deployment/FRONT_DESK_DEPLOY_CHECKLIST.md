# Front Desk Deploy Checklist

**Last updated:** 2026-07-01

Combined Firebase UI + Cloud Run API deploy gate for the NYC front-desk pilot.

## Pre-deploy verification (local)

```bash
cd middleware-platform
npm run verify:staging-parity
npm run verify:log-redaction
npm run verify:phase6-ops
npm run verify:pilot-scenario-matrix
npm run pre-deploy:smoke
npm run verify:deploy-readiness
```

`verify:deploy-readiness` runs `ci:gate` when present, then `verify:front-desk-pilot` (Phases 0–3 + billing structural gates).

## Kelly Rails env (staging + production)

Set on Cloud Run `somo-middleware` before voice traffic:

| Variable | Required value |
|----------|----------------|
| `KELLY_RAILS_V2` | `1` |
| `KELLY_RAILS_ROLLOUT_PCT` | `1` |
| `KELLY_ALLOW_HYBRID_GRAPH` | `0` or unset |
| `CONVERSATION_MODE_ROUTING` | `enforce` (staging may use `shadow` during soft launch) |
| `OPQRST_FIELD_GATE_ENABLED` | `1` or unset (default on) |

Verify live Cloud Run env:

```bash
npm run verify:kelly-rails-cloudrun
```

Compare local/staging `.env` against checklist:

```bash
npm run verify:staging-parity
```

## Deploy sequence

1. **Push** feature branch to GitHub; confirm CI green on changed packages.
2. **API** — `npm run callsomo:deploy-api` (or `CLOUDRUN_PROFILE=production ./scripts/deploy-to-gcp-production.sh`).
3. **UI** — `npm run callsomo:deploy-ui` when `unified-dashboard/` changed.
4. **Smoke** — `npm run smoke:callsomo` and `curl -i https://api.callsomo.com/health`.
5. **Pilot gate** — `npm run verify:front-desk-pilot` against staging DB/creds when applicable.

See also: [FRONT_DESK_PRODUCTION.md](./FRONT_DESK_PRODUCTION.md), [OPERATIONS.md](./OPERATIONS.md), [phase2-pilot-checklist.md](../voice-agent/phase2-pilot-checklist.md).

## Post-deploy

- Record Cloud Run revision + Kelly env snapshot in deploy notes.
- Run backup drill checklist: `node middleware-platform/scripts/backup-drill-checklist.cjs`.
- Secrets rotation: [SECRETS_ROTATION.md](../runbooks/SECRETS_ROTATION.md).
- Ops snapshot: `node middleware-platform/scripts/report-front-desk-ops.cjs`.
- On-call week: [PILOT_ONCALL_WEEK.md](../voice-agent/PILOT_ONCALL_WEEK.md).
- Dental tenants: confirm provider portal hides Revenue + Video nav (`office_type=dental`).

## Rollback

- Cloud Run: roll to previous revision in GCP console.
- Voice soft rollback: set `CONVERSATION_MODE_ROUTING=shadow` and redeploy.
- See [CONVERSATION_MODE_ROLLOUT.md](../runbooks/CONVERSATION_MODE_ROLLOUT.md).
