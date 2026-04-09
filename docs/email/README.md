# Email Service Documentation

Documentation for email functionality and configuration.

## Current Setup

- **Provider:** Azure Communication Services (production)
- **Domain:** doclittle.site
- **Sender:** DoNotReply@doclittle.site
- **Status:** Production Ready

## Configuration

### Local Development

See [Local Email Setup](./LOCAL_EMAIL_SETUP.md) for Gmail/SMTP setup.

### Production

- Azure Communication Services
- Connection string in `.env`: `AZURE_COMMUNICATION_CONNECTION_STRING`
- Verify sender address in Azure portal

## Email Types

1. Appointment confirmation
2. Insurance billing
3. Patient billing
4. Checkout verification

## Related Documentation

- [Azure Setup](../azure/README.md)
- [Setup Guide](../setup/getting-started/SETUP.md)
- [Email Issues Verification](./email-issues-verification.md)
- [Main Docs](../README.md)

---

**Last Updated:** April 9, 2026
