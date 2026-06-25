# Navigation operator runbook

## DIDs

| Number | Role |
|--------|------|
| +13639990205 (`TWILIO_PHONE_NUMBER`) | **Consumer navigation inbound** — dial this for SomoPay pitch |
| +18623622415 | Phase 1 tenant Kelly line (unchanged; no Twilio work) |
| +18622307479 | Transfer target only (answer for escalation) |

## Prep

```bash
npm run phase1:pull-db          # repo root
cd middleware-platform
npm run navigation:seed
npm run navigation:preflight
npm run callsomo:deploy-api     # repo root — ship routing code
npm run navigation:gcs-seed       # prod GCS upload + Cloud Run restart
```

**Twilio:** No webhook change required if `+13639990205` already POSTs to `https://api.callsomo.com/voice/incoming`. Navigation wins on inbound `To` even when the URL has `?customer_id=<operator>`.

## Live gates

```bash
npm run navigation:routing-live -- --pull-db --latest
npm run navigation:resolve-plan-live -- --session call_xxx
npm run navigation:benefits-live -- --session call_xxx
npm run navigation:find-care-live -- --session call_xxx
npm run navigation:pitch-e2e-live -- --session call_xxx
npm run navigation:operator-gate -- mark --step p1-routing --notes "AT-P1-001 green"
```

## Kill switch

Set `NAVIGATION_ENABLED=0` on Cloud Run to disable navigation handler (fail-closed message).

## Evidence

`middleware-platform/var/evidence/navigation/` — P0_GATE.json, P1_GATE.json, OPERATOR_STATUS.json
