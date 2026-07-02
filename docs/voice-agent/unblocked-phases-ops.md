# Phase 4–9 Unblocked Ops

## Ops alerts (Phase 2)

Set on production Cloud Run / `.env`:

```bash
ELIGIBILITY_ALERT_SLACK_WEBHOOK=https://hooks.slack.com/...
PAYMENT_ALERT_SLACK_WEBHOOK=https://hooks.slack.com/...
PILOT_INVITE_ONLY=1          # disable self-serve signup during pilot
PILOT_RATE_LIMIT_ENABLED=1   # rate limit roster + invite APIs
```

## Verify gates

```bash
cd middleware-platform
npm run verify:unblocked-phases
npm run verify:phase5-fast-follows
npm run verify:phase6-ops
npm run verify:phase7-portal
npm run verify:phase8-loop
npm run verify:phase9-deploy
npm run verify:staging-parity
npm run verify:log-redaction
npm run verify:pilot-scenario-matrix
npm run verify:dental-pstn-eval
npm run verify:no-triage-front-desk
npm run report:front-desk-ops
npm run verify:phase3-sandbox   # full PMS sandbox
npm run verify:ops-alerts-prod        # dev: informational
STRICT=1 npm run verify:ops-alerts-prod  # prod deploy
```

## Deploy smoke (prod)

```bash
npm run ci:gate          # repo root
npm run verify:deploy-readiness
npm run pre-deploy:smoke
```

## Playwright (local)

```bash
cd middleware-platform
npx playwright test e2e/provider/onboarding-journey.spec.cjs
```

## Shadow week

```bash
npm run setup:phase2-shadow -- --clinic-id <clinic_id>
# Then PATCH clinic shadow_week_active=1 via /api/tenant/clinic
```

## Manual (pilot week)

- [ ] Configure Slack webhooks in prod (`ELIGIBILITY_ALERT_SLACK_WEBHOOK`, `PAYMENT_ALERT_SLACK_WEBHOOK`)
- [ ] Run GCS backup drill and record date (`backup-drill-checklist.cjs`, `docs/runbooks/SECRETS_ROTATION.md`)
- [ ] Run `dental:pstn-scenarios` before each deploy
- [ ] Hourly `report:front-desk-ops` during first live week

## Henry Schein (manual)

Submit API Exchange application: https://www.dentrixascend.com/api — track in plan todo `fd3-henry-schein`.

## K1 decision

Default pilot recommendation: **Dentrix Ascend + E10 interim** until Henry Schein approves. Document per-office choice in admin tenant notes.

## Multi-location (fd4-multiloc-arch)

v1: one clinic_id per customer; multi-location deferred until pipeline demands second site.

## Related runbooks

- [`PILOT_ONCALL_WEEK.md`](./PILOT_ONCALL_WEEK.md)
- [`PILOT_INCIDENT_PLAYBOOK.md`](./PILOT_INCIDENT_PLAYBOOK.md)
- [`SHADOW_WEEK_RUNBOOK.md`](./SHADOW_WEEK_RUNBOOK.md)
- [`pilot-scenario-matrix.md`](./pilot-scenario-matrix.md)
