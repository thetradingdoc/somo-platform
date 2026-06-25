# Phase 1 operator runbook

**Revision:** `somo-middleware-00114-f69` · **Image:** `6cdfda9`  
**Rule:** Offline Jest/smoke does not close Phase 1. Real PSTN required.

## Quick commands

```bash
# Repo root
npm run phase1:pull-db

# middleware-platform (or --prefix from root)
npm run phase1:inventory
npm run phase1:checklist
npm run phase1:probe-demo          # automated Twilio call → platform DID
npm run phase1:verify -- --world demo --session call_xxx
npm run phase1:verify -- --world tenant --session call_xxx
npm run phase1:verify -- --world unidentified --session call_xxx
npm run phase1:verify -- --world booking --session call_xxx
npm run phase1:status
```

## Order

1. **Prep** — pull DB, inventory, configure transfer (T-001)
2. **T-001** — staging PSTN → escalation → phone rings → log OPERATIONS.md
3. **PD-4** — five live calls (see [PHASE1_PD4_LOG.md](../deployment/PHASE1_PD4_LOG.md))
4. **Booking** — prod tenant DID → `verify:live-booking-call` → portal check

## T-001 transfer setup

```bash
# Option A: local DB copy (review before GCS upload)
DB_PATH=../backups/middleware-staging.db node scripts/phase1-set-transfer-target.cjs +1YOURMOBILE

# Option B: Cloud Run env (no DB upload)
gcloud run services update somo-middleware --region=us-central1 --project=somo-callsomo \
  --update-env-vars CALLSOMO_OPERATOR_FALLBACK_PSTN=+1YOURMOBILE
```

## Mark manual steps

```bash
node scripts/phase1-operator-gate.cjs mark --step t001-ring --session call_xxx --notes "PSTN rang"
node scripts/phase1-operator-gate.cjs mark --step booking_portal --notes "saw appointment in portal"
```

Track file: `middleware-platform/var/evidence/phase1/OPERATOR_STATUS.json`

## DIDs

See [PHASE1_DID_INVENTORY.md](../deployment/PHASE1_DID_INVENTORY.md).
