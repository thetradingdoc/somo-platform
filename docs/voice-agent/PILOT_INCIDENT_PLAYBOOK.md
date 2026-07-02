# NYC Front Desk — Pilot Incident Playbook

**Last updated:** 2026-07-01

Operator runbook for live pilot incidents on Kelly voice rails (dental front desk). Use with [`pilot-scenario-matrix.md`](./pilot-scenario-matrix.md) and [`phase2-pilot-checklist.md`](./phase2-pilot-checklist.md).

## Severity levels

| Level | Examples | Response time |
|-------|----------|---------------|
| **SEV-1** | PHI leak on call, payment charged wrong amount, emergency mis-routed | Immediate — kill switch + page on-call |
| **SEV-2** | Stedi down for all calls, transfer loop, booking double-book | < 15 min — shadow mode or handoff |
| **SEV-3** | Single-tenant config drift, thin-271 spike, ASR low confidence | < 1 hr — tenant patch + monitor |
| **SEV-4** | Non-blocking UX, portal lag, stale opener | Next business day |

## Kill switch (SEV-1 / SEV-2)

1. Set `CONVERSATION_MODE_ROUTING=shadow` on Cloud Run (or tenant `voice_kill_switch=1` if enabled).
2. Confirm Twilio `transfer_number` forwards to live front desk.
3. Post in `#voice-pilot` with clinic_id, session_id, and timestamp (UTC).

```bash
# Cloud Run — shadow replies (quotes logged, not spoken if shadow week)
gcloud run services update somo-middleware --region=us-central1 --project=somo-callsomo \
  --update-env-vars="CONVERSATION_MODE_ROUTING=shadow"
```

Rollback when green: `CONVERSATION_MODE_ROUTING=enforce` — see [`CONVERSATION_MODE_ROLLOUT.md`](../runbooks/CONVERSATION_MODE_ROLLOUT.md).

## Common incidents

### Stedi / eligibility timeout (SEV-2)

**Signals:** `stedi_circuit_open` in logs, caller hears desk callback offer, no copay quote.

**Actions:**
1. Check Stedi status + `STEDI_TEST_MODE` / prod key on tenant.
2. Verify circuit breaker: `middleware-platform/services/stedi-circuit-breaker.js`.
3. Confirm handoff copy — no invented copay amounts.
4. Metering: eligibility checks still logged in `eligibility_usage_events`; overage alerts via `ELIGIBILITY_ALERT_SLACK_WEBHOOK`.

### Wrong copay spoken (SEV-1)

**Signals:** Desk quote ≠ `amount_resolution_log` row.

**Actions:**
1. Enable shadow week: `npm run setup:phase2-shadow -- --clinic-id <id>`.
2. Pull session forensics: `GET /api/kelly/calls/:sessionId`.
3. Compare `amount_resolution_log` vs spoken transcript in Retell dashboard.
4. Do **not** re-enable `copay_quote_speak_enabled=1` until shadow week passes.

### Transfer loop / no human answer (SEV-2)

**Signals:** `handoff_failed` disposition, repeated `transfer_call`.

**Actions:**
1. Validate tenant `transfer_number` E.164 in portal voice settings.
2. Check Twilio forwarding doc: [`CALL_FORWARDING_SETUP.md`](../runbooks/CALL_FORWARDING_SETUP.md).
3. Warm transfer fallback: offer callback number + SMS.

### PHI boundary breach (SEV-1)

**Signals:** Kelly confirms another patient's name/DOB/member ID.

**Actions:**
1. Kill switch immediately.
2. Log HIPAA access review — `hipaa_access_log`.
3. File customer BAA incident per [`FRONT_DESK_PHASE0_BAA_CHECKLIST.md`](../compliance/FRONT_DESK_PHASE0_BAA_CHECKLIST.md).

### PMS write-back failure (SEV-3)

**Signals:** Booking succeeds in Somo hub but no calendar note in PMS.

**Actions:**
1. Run `node scripts/e2e-phase3-pms-writeback.cjs` for clinic_id.
2. Check `pms_sync_log` / Phase 3 orchestration traces.
3. E10 interim: CSV digest to desk email until Dentrix API approved.

## Verification gates (pre/post incident)

```bash
cd middleware-platform
npm run verify:phase8-loop          # disposition + dental eval + trace
npm run verify:golden-loop-somo     # full Somo golden chain
npm run verify:front-desk-pilot     # master pilot gate
```

## Escalation contacts

| Role | Channel |
|------|---------|
| Voice on-call | `#voice-pilot` Slack |
| Eligibility / Stedi | `#rcm-ops` + Stedi support portal |
| Payments / Stripe | `#billing-ops` + Stripe dashboard alerts |
| Compliance | compliance@callsomo.com |

## Post-incident

1. Capture `session_id`, Retell call_id, Cloud Run revision.
2. Add row to pilot incident log (internal).
3. If code fix required: run `npm run verify:phase8-loop` before redeploy.
4. Update [`pilot-scenario-matrix.md`](./pilot-scenario-matrix.md) if new utterance class discovered.

## Related docs

- [`FRONT_DESK_PRODUCTION.md`](../deployment/FRONT_DESK_PRODUCTION.md) — deploy + preflight
- [`GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md) — rollback
- [`TENANT_OFFBOARDING.md`](../runbooks/TENANT_OFFBOARDING.md) — pilot exit
