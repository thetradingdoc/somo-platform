# Front Desk Deploy Checklist

**Last updated:** 2026-07-02

Combined Firebase UI + Cloud Run API deploy gate for the NYC front-desk pilot.

## Pilot prod apply (operator)

```bash
cd middleware-platform
npm run setup:pilot-prod-env -- --apply          # PILOT_* + Slack webhooks on Cloud Run
../scripts/provision-production-secrets.sh         # API_KEY_ENCRYPTION_KEY etc.
CLOUDRUN_VERIFY=1 npm run verify:cloudrun-pilot-prod
npm run verify:compliance-readiness
```

Retell volume: confirm production tier supports pilot call volume in Retell dashboard before go-live week.

## Pre-deploy verification (local)

```bash
cd middleware-platform
npm run verify:staging-parity
npm run verify:log-redaction
npm run verify:phase6-ops
npm run verify:pilot-scenario-matrix
npm run pre-deploy:smoke
npm run verify:deploy-readiness
npm run verify:front-desk-pilot
```

`verify:deploy-readiness` runs `ci:gate` when present, then `verify:front-desk-pilot` (unblocked phases + Kelly env + prod readiness).

## Kelly Rails env (staging + production)

Set on Cloud Run `somo-middleware` before voice traffic:

| Variable | Required value |
|----------|----------------|
| `KELLY_RAILS_V2` | `1` |
| `KELLY_RAILS_ROLLOUT_PCT` | `1` |
| `KELLY_ALLOW_HYBRID_GRAPH` | `0` or unset |
| `CONVERSATION_MODE_ROUTING` | `enforce` (staging may use `shadow` during soft launch) |
| `OPQRST_FIELD_GATE_ENABLED` | `1` or unset (default on) |

## Pilot production env (office #1)

Set on Cloud Run before live pilot traffic (`fd-ops-pilot-env-prod`, `fd-prod-stedi-cloudrun`):

| Variable | Required value |
|----------|----------------|
| `PILOT_INVITE_ONLY` | `1` |
| `PILOT_RATE_LIMIT_ENABLED` | `1` |
| `STEDI_TEST_MODE` | `0` (after prod Stedi key enrolled) |
| `VOICE_ELIGIBILITY_SIMULATE` | `0` |
| `ELIGIBILITY_ALERT_SLACK_WEBHOOK` | Slack URL (strict prod) |
| `PAYMENT_ALERT_SLACK_WEBHOOK` | Slack URL (strict prod) |
| `API_KEY_ENCRYPTION_KEY` | Secret Manager ref (PMS credentials) |

Verify:

```bash
npm run verify:pilot-prod-readiness
PILOT_PROD_STRICT=1 CLOUDRUN_VERIFY=1 npm run verify:pilot-prod-readiness
npm run setup:phase2-prod-stedi
npm run setup:pilot-prod-env
```

Stedi cutover runbook: `docs/voice-agent/phase2-pilot-checklist.md`

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
5. **Pilot gate** — `npm run verify:front-desk-pilot` and `PILOT_PROD_STRICT=1 npm run verify:pilot-prod-readiness` when prod Stedi enrolled.

See also: [FRONT_DESK_PRODUCTION.md](./FRONT_DESK_PRODUCTION.md), [OPERATIONS.md](./OPERATIONS.md), [phase2-pilot-checklist.md](../voice-agent/phase2-pilot-checklist.md).

## Post-deploy

- Record Cloud Run revision + Kelly env snapshot in [`PHASE0_DEPLOY_STATE.md`](./PHASE0_DEPLOY_STATE.md).
- Configure Retell: `RETELL_API_KEY` in `middleware-platform/.env` → `npm run deploy:callsomo` runs `configure-retell.js` + `callsomo-operator-sync.cjs`.
- Run backup drill: `npm run verify:backup-drill` — record in [`BACKUP_DRILL_RECORD.md`](./BACKUP_DRILL_RECORD.md).
- Secrets rotation: [SECRETS_ROTATION.md](../runbooks/SECRETS_ROTATION.md).
- Ops snapshot: `node middleware-platform/scripts/report-front-desk-ops.cjs`.
- On-call week: [PILOT_ONCALL_WEEK.md](../voice-agent/PILOT_ONCALL_WEEK.md).
- Dental tenants: confirm provider portal hides Revenue + Video nav (`office_type=dental`).

## Rollback

- Cloud Run: roll to previous revision in GCP console.
- Voice soft rollback: set `CONVERSATION_MODE_ROUTING=shadow` and redeploy.
- See [CONVERSATION_MODE_ROLLOUT.md](../runbooks/CONVERSATION_MODE_ROLLOUT.md).
