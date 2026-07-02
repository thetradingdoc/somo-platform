# Secrets rotation runbook — front desk pilot

Rotate credentials on a **90-day** cadence or immediately after suspected exposure.

## Scope

| Secret | Where stored | Consumers |
|--------|--------------|-----------|
| `STEDI_API_KEY` | GCP Secret Manager / Cloud Run | `insurance-service` |
| `STRIPE_SECRET_KEY` / webhooks | GCP Secret Manager | RCM, billing webhooks |
| `TWILIO_AUTH_TOKEN` | GCP Secret Manager | Voice ingress |
| `RETELL_API_KEY` | GCP Secret Manager | Voice agent |
| `INTERNAL_JOB_TOKEN` | Cloud Run env | Internal replay / jobs |
| Session signing | Cloud Run env | Provider portal cookies |

## Rotation procedure

1. **Stage** — create new key in vendor console (Stripe: roll key; Stedi: issue new API key).
2. **Deploy** — update Secret Manager version; redeploy Cloud Run with new secret binding:
   ```bash
   npm run callsomo:deploy-api   # or production script
   ```
3. **Verify** — smoke tests:
   ```bash
   cd middleware-platform
   npm run verify:stedi-env
   npm run verify:stripe-keys
   npm run smoke:callsomo
   node scripts/report-front-desk-ops.cjs
   ```
4. **Revoke** — disable old key in vendor console after 24h clean traffic.
5. **Audit** — check `GET /api/admin/payment-ops/secrets/audit` for abnormal access.

## SQLite backup coordination

Do **not** rotate `DB_PATH` or GCS bucket during active calls.

1. Run read-only drill: `node middleware-platform/scripts/backup-drill-checklist.cjs`
2. Confirm latest `gs://$GCS_DB_BUCKET/backups/` object
3. Record rotation + backup drill date in deploy notes

## Emergency

If a secret is leaked in logs or chat:

1. Revoke immediately in vendor console
2. Rotate Cloud Run secret + redeploy
3. Run `npm run verify:log-redaction`
4. Notify compliance lead per [HIPAA_RISK_ASSESSMENT_CHECKLIST.md](../compliance/templates/HIPAA_RISK_ASSESSMENT_CHECKLIST.md)
