# Phase 1 DID inventory

**SSOT:** [VOICE_ROUTING_SSOT.md](../voice/VOICE_ROUTING_SSOT.md)

**Generated for revision:** `somo-middleware-00114-f69` · image `gcr.io/somo-callsomo/somo-middleware:6cdfda9`  
**Refresh:** `npm run phase1:inventory --prefix middleware-platform` after `npm run phase1:pull-db`

| Role | Number | Source |
|------|--------|--------|
| **Platform support** (operator / admin) | `+13639990205` | Operator `customers.twilio_phone_number` + Twilio voice URL |
| Tenant DID (when real practice exists) | `+18623622415` | Tenant customer row — archived Doclittle until replaced |
| Operator customer | `richard@callsomo.com` | `CALLSOMO_OPERATOR_CUSTOMER_ID` |
| Transfer target (T-001) | **Your mobile** | `CALLSOMO_OPERATOR_FALLBACK_PSTN` |
| Twilio probe FROM (automated PD-4) | `+12028131474` | Set `PD4_PROBE_FROM_NUMBER` — must differ from platform DID |

## Prod DB snapshot notes

- GCS object: `gs://somo-staging-db-somo-callsomo/middleware-staging.db`
- `customers.twilio_phone_number` may be empty — inbound uses Twilio webhook `customer_id` query param.
- `clinic-default` exists; set `transfer_number` before T-001 (see below).
- Cloud Run has `STAGING=1` on the single `somo-middleware` service.

## T-001 transfer configuration

**Option A — clinic row (preferred for staging tenant):**

```bash
# On pulled DB (operator mobile — replace E164)
sqlite3 backups/middleware-staging.db \
  "UPDATE clinics SET transfer_number='+1XXXXXXXXXX' WHERE clinic_id='clinic-default';"
# Upload only after review — see middleware-platform/scripts/cloudrun-db-sync.cjs
```

**Option B — Cloud Run env fallback:**

```bash
gcloud run services update somo-middleware --region=us-central1 --project=somo-callsomo \
  --update-env-vars CALLSOMO_OPERATOR_FALLBACK_PSTN=+1XXXXXXXXXX
```

## Operator tooling

```bash
npm run phase1:pull-db          # repo root
npm run phase1:inventory        # middleware-platform
npm run phase1:checklist
npm run phase1:verify -- --world demo --session call_xxx
```
