# Phase 3 — Dentrix Ascend setup (Phase 3B)

Requires Henry Schein API Exchange approval. Code is ready; vendor credentials unblock live sandbox E2E.

## Prerequisites

1. Apply for API Exchange: https://www.henryscheinone.com/dental-solutions/api-exchange/
2. Obtain sandbox `client_id`, `client_secret`, and organization/location IDs

## Somo configuration

```bash
# Checklist + application link
npm run setup:henry-schein-application

# After credentials in .env
npm run discover:dentrix-sandbox
npm run setup:phase3-dentrix-pilot
npm run verify:phase3-dentrix
```

## Env vars

| Variable | Purpose |
|----------|---------|
| `DENTRIX_CLIENT_ID` | OAuth client id from API Exchange |
| `DENTRIX_CLIENT_SECRET` | OAuth client secret |
| `DENTRIX_ORGANIZATION_ID` | Ascend organization (from `discover:dentrix-sandbox`) |
| `DENTRIX_LOCATION_ID` | Scheduling location |
| `DENTRIX_OPERATORY_ID` | Optional operatory for bookings |
| `DENTRIX_DEFAULT_APPOINTMENT_TYPE_ID` | Optional appointment type |

## Implementation

- Config: `middleware-platform/services/pms/dentrix-config.js`
- Client: `middleware-platform/services/pms/dentrix-client.js`
- Adapter: `middleware-platform/services/pms/dentrix-adapter.js`

API reference: https://papidocs.hs1api.com/publicapi/api-consumer-guide
