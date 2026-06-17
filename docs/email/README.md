# Email (transactional + local dev)

**Last updated:** 2026-06-15

## Transactional HTML (production)

| Piece | Path |
|-------|------|
| Shared layout (logo, colors, footer) | [`middleware-platform/lib/somo-email-layout.js`](../../middleware-platform/lib/somo-email-layout.js) |
| Template implementations | [`middleware-platform/services/email-service.js`](../../middleware-platform/services/email-service.js), [`invoice-service.js`](../../middleware-platform/services/invoice-service.js) |
| Brand rules | [`docs/Brand/LOGO_AND_ICON_SSOT.md`](../Brand/LOGO_AND_ICON_SSOT.md) § Transactional email |

## Production on GCP (SMTP)

Cloud Run staging uses **SMTP only** (`EMAIL_PROVIDER=smtp`). Azure Communication Services is not used on GCP.

| Variable | Purpose |
|----------|---------|
| `EMAIL_PROVIDER` | `smtp` (GCP staging) or `auto` (legacy Azure-first) |
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `richard@callsomo.com` |
| `SMTP_PASSWORD` | GCP Secret Manager: `somo-smtp-password` |
| `SMTP_FROM` | e.g. `Somo <richard@callsomo.com>` |

Health check:

```bash
curl -sS https://api.callsomo.com/health/email
```

Verify send:

```bash
cd middleware-platform
node scripts/verify-email-provider.cjs you@example.com
```

Deploy binds `SMTP_PASSWORD` from Secret Manager via [`generate-cloudrun-env-yaml.cjs`](../../middleware-platform/scripts/generate-cloudrun-env-yaml.cjs) (`SECRET_SMTP_PASSWORD=somo-smtp-password`).

Rotate SMTP app password:

```bash
# Create new Gmail app password for SMTP_USER mailbox, then:
printf '%s' 'YOUR_16_CHAR_APP_PASSWORD' | gcloud secrets versions add somo-smtp-password --data-file=- --project=somo-callsomo
gcloud run services update somo-middleware --region=us-central1 --project=somo-callsomo --update-env-vars "EMAIL_SYNC=$(date +%s)"
```

## Local SMTP setup

Add to `middleware-platform/.env`:

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-gmail-app-password
SMTP_FROM=your-email@gmail.com
BASE_URL=http://localhost:4000
```

Gmail app passwords: https://myaccount.google.com/apppasswords

Test:

```bash
cd middleware-platform
node scripts/verify-email-provider.cjs
```

Interactive setup: `node scripts/configure-local-email.js`

## Legacy Azure (not used on GCP staging)

Azure ACS (`AZURE_COMMUNICATION_CONNECTION_STRING`) is stripped from staging Cloud Run deploys. Use `EMAIL_PROVIDER=auto` only for legacy Azure environments.

## Related

- [Setup index](../setup/README.md)
- Archived voice-checkout email debugging (2026): [archive/email-voice-checkout-verification-2026.md](../archive/email-voice-checkout-verification-2026.md)
