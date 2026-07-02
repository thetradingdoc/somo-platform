# Pilot on-call week — Kelly front desk

Operator runbook for the first live office week. Pair with [`report-front-desk-ops.cjs`](../../middleware-platform/scripts/report-front-desk-ops.cjs) and Slack webhooks.

## Before go-live

1. Run deploy checklist: [`FRONT_DESK_DEPLOY_CHECKLIST.md`](../deployment/FRONT_DESK_DEPLOY_CHECKLIST.md)
2. `npm run verify:phase6-ops` and `npm run verify:pilot-scenario-matrix`
3. Set prod env:
   - `ELIGIBILITY_ALERT_SLACK_WEBHOOK`
   - `PAYMENT_ALERT_SLACK_WEBHOOK`
   - `PILOT_INVITE_ONLY=1`
4. Confirm Cloud Run **`max-instances=1`** (SQLite on GCS)
5. Dental tenant: Revenue + Video nav hidden (`office_type=dental`)

## Hourly checks (business hours)

```bash
cd middleware-platform
node scripts/report-front-desk-ops.cjs
```

| Signal | Action |
|--------|--------|
| `STEDI_CIRCUIT_OPEN` | Kelly fail-closed — notify office; check Stedi status |
| `PMS_SYNC_BACKLOG` | Review calendar PMS badge; retry sync or manual entry |
| Stripe webhook failures | Check `/api/admin/payment-ops/alerts` or payment-ops SLO |
| Zero voice calls 24h | Verify line forward + Kelly toggle on |

## Escalation

1. **Kelly silent** — kill switch off? Twilio number routing? `KELLY_RAILS_V2=1` on Cloud Run?
2. **Wrong copay** — compare dashboard call detail vs desk; check `amount_resolution_log`
3. **PHI concern** — run `npm run verify:log-redaction`; rotate logs if leak suspected

See [PILOT_INCIDENT_PLAYBOOK.md](./PILOT_INCIDENT_PLAYBOOK.md).

## End of week

- [ ] Backup drill recorded (`node scripts/backup-drill-checklist.cjs`)
- [ ] Scenario matrix gaps updated in [`pilot-scenario-matrix.md`](./pilot-scenario-matrix.md)
- [ ] Set `pilot_live_at` on clinic when office signs off
