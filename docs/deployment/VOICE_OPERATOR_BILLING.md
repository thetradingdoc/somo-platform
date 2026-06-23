# Voice operator billing



Operator (Somo platform) voice calls use the same `customers` + `usage_events` ledger as tenants.



## Environment



| Variable | Purpose |

|----------|---------|

| `CALLSOMO_OPERATOR_CUSTOMER_ID` | Operator `customers.id` for all operator-initiated outbound |

| `CALLSOMO_VOICE_CUSTOMER_ID` | Legacy alias — inbound operator Twilio number binding |

| `VOICE_OPERATOR_READY_REQUIRED` | `1` = refuse Cloud Run boot if operator row missing from DB |

| `TWILIO_OUTBOUND_WEBHOOK_URL` | Force prod webhook base for `make-outbound-call.js` (avoids ngrok) |



## Bootstrap



```bash

cd middleware-platform



# 1. Rollback snapshot (mandatory before prod DB edits)

gsutil cp gs://somo-staging-db-somo-callsomo/middleware-staging.db \

  gs://somo-staging-db-somo-callsomo/backups/middleware-staging-$(date +%Y%m%d-%H%M%S).db



# 2. Download working copy

GCS_DB_BUCKET=somo-staging-db-somo-callsomo \

DB_PATH=./backups/middleware-staging.db \

node scripts/cloudrun-db-sync.cjs download



# 3. Fingerprint (record before/after)

sqlite3 ./backups/middleware-staging.db \

  "SELECT COUNT(*) FROM customers; SELECT MAX(applied_at) FROM schema_migrations;"



# 4. Seed operator (Twilio customer_id is source of truth)

DB_PATH=./backups/middleware-staging.db \

CALLSOMO_OPERATOR_CUSTOMER_ID=cust_b7c7d3e1-31e6-4fbb-b6fd-8e306a79fad8 \

SOMO_OWNER_EMAIL=richard@callsomo.com \

node scripts/seed-operator-customer.cjs



# 5. Upload

GCS_DB_BUCKET=somo-staging-db-somo-callsomo \

DB_PATH=./backups/middleware-staging.db \

node scripts/cloudrun-db-sync.cjs upload

```



Set `CALLSOMO_OPERATOR_CUSTOMER_ID` on Cloud Run (see `scripts/generate-cloudrun-env-yaml.cjs`).



**Staging SQLite:** deploy uses `--max-instances 1` (see `scripts/deploy-to-gcp.sh`) so all instances share one GCS DB copy.

**Upload guard:** Cloud Run shutdown upload is blocked if `CALLSOMO_OPERATOR_CUSTOMER_ID` is set but missing from the local DB (prevents empty DB clobbering GCS). Force with `GCS_DB_UPLOAD_FORCE=1` for intentional uploads.



## Preflight (no phone)



```bash

STAGING_DB_PATH=./backups/middleware-staging.db \

CALLSOMO_OPERATOR_CUSTOMER_ID=cust_b7c7d3e1-31e6-4fbb-b6fd-8e306a79fad8 \

npm run preflight:operator-voice



# After deploy — prove live instance uses same DB fingerprint

npm run preflight:operator-voice -- --live-api

```



Checks: GCS backup, DB fingerprint, duplicate operators/emails, FK, resolution paths A/B/C, Twilio voice + status callbacks, Retell agent, Cloud Run scaling, billing smoke, **operator outbound_opener** in `voice_agent_settings`.



## Post-deploy opener verification



After deploying opener fixes and patching prod DB:



```bash

cd middleware-platform



# DB + opener copy (local copy of prod DB)

STAGING_DB_PATH=./backups/middleware-staging.db node scripts/operator-outbound-smoke.cjs



# Live health + optional test call

API_BASE_URL=https://api.callsomo.com node scripts/operator-outbound-smoke.cjs --live --test-call 8622307479

```



**Pass criteria (what you should hear):**



- Single opener on answer — mentions **Somo** (not "our office" or "Somo owner")
- No duplicate Kelly intro immediately after opener (`callback_intro` skipped when `opener_delivered`)
- Cloud Run logs: `voice_opener_sent` JSON with `direction: outbound`, `callType: operator_outbound`
- `kelly_call_events` row with `event_type: call_opener_used` for the call

## Operator outbound stages (O-1)

Rail: `services/conversation/rails/operator-outbound-rail.js`

| Stage | Purpose |
|-------|---------|
| `callback_intro` | Somo-branded opener; skipped when `opener_delivered` |
| `update` | Reminder or account update |
| `confirm` | Acknowledge caller response |
| `handoff_offer` | Offer human callback |
| `close` | Polite end |

**Voicemail (O-2):** Single short message then `endCall` when IVR/voicemail detected.

**Register (O-3):** Outbound must set `call_type=operator_outbound`, `customer_id`, optional `appointment_id` / `outbound_purpose` in Twilio URL + Retell dynamic variables.



**Prod DB patch (company_name + crisp opener):**



```bash

node scripts/rollout-voice-outbound-opener.cjs --apply-prod-db

# Uses gcloud storage cp fallback when Node @google-cloud/storage auth fails

```



Then restart Cloud Run so instances reload GCS SQLite.



## Health endpoint



```bash

curl -sS https://api.callsomo.com/health/voice-operator | jq

```



Returns `db_fingerprint`, `operator_row_present`, `issues`. Returns **503** when not ready.



## Outbound script



```bash

TWILIO_OUTBOUND_WEBHOOK_URL=https://api.callsomo.com \

node scripts/make-outbound-call.js 8622307479

```



Webhook: `/voice/incoming?call_type=operator_outbound&customer_id={operator}&agent_id={kelly}`



## Operator sync (Twilio + Retell)



```bash

CALLSOMO_OPERATOR_CUSTOMER_ID=cust_... API_BASE_URL=https://api.callsomo.com \

node scripts/callsomo-operator-sync.cjs

```



Syncs voice URL, status callback URL, Retell WSS, and verifies agent exists.



## Billing



- Operator row: `customer_type=operator`, `billing_enforcement_paused=1` (meter without blocking)

- Minutes logged to `usage_events` with `direction=outbound` or `inbound`

- Lead CRM calls (`sales_outbound`) bill operator account when `CALLSOMO_OPERATOR_CUSTOMER_ID` is set

- Telephony-free proof: `npm run smoke:operator-billing`



## Billing policy decisions



- **D1 Tokens:** Customers billed on **minutes only**; LLM tokens logged in `llm_usage_log` for cost analytics, not customer invoices.

- **C4 SMS:** SMS usage tracked in `sms_usage_log` separately; not deducted from voice minute pool unless product changes.

- **C10 Demo:** Demo calls metered to operator account (`billing_enforcement_paused`); internal cost attribution only.

- **Lead outbound:** Bills operator `usage_events` pool; `monthly_call_usage` 250/mo cap retained as secondary guard.

- **ADMIN_PORTAL_SECRET:** Break-glass alongside operator customer login with capabilities.

