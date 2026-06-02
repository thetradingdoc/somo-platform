# Email (transactional + local dev)

**Last updated:** 2026-06-02

## Transactional HTML (production)

| Piece | Path |
|-------|------|
| Shared layout (logo, colors, footer) | [`middleware-platform/lib/somo-email-layout.js`](../../middleware-platform/lib/somo-email-layout.js) |
| Template implementations | [`middleware-platform/services/email-service.js`](../../middleware-platform/services/email-service.js), [`invoice-service.js`](../../middleware-platform/services/invoice-service.js) |
| Brand rules | [`docs/Brand/LOGO_AND_ICON_SSOT.md`](../Brand/LOGO_AND_ICON_SSOT.md) § Transactional email |

Production sender: Azure Communication Services (`DoNotReply@api.callsomo.com`). Override logo URL with `SOMO_EMAIL_LOGO_URL` if needed.

## Local SMTP setup

Add to `middleware-platform/.env`:

```bash
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
node scripts/test-email-payment-link.js
```

Interactive setup: `node scripts/configure-local-email.js`

## Related

- [Setup index](../setup/README.md)
- [GCP cutover](../runbooks/CALLSOMO_GCP_CUTOVER.md)
- Archived voice-checkout email debugging (2026): [archive/email-voice-checkout-verification-2026.md](../archive/email-voice-checkout-verification-2026.md)
