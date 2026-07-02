# Phase 3 — Athena setup (Phase 3B)



Medical EHR integration via athenaOne REST (2-legged OAuth).



## Prerequisites



1. Register at https://developer.api.athena.io/ams-portal/

2. Create app — 2-legged OAuth, Secret auth, non-certified APIs for scheduling

3. Submit Technical Request Form (TRF) + BAA for production scheduling scope

4. Obtain `practice_id` and `department_id` from pilot practice or sandbox discovery



## Local environment



Add to `middleware-platform/.env`:



```bash

ATHENA_CLIENT_ID=

ATHENA_CLIENT_SECRET=

ATHENA_API_BASE=https://api.preview.platform.athenahealth.com

ATHENA_TOKEN_URL=https://api.preview.platform.athenahealth.com/oauth2/v1/token

ATHENA_PRACTICE_ID=

ATHENA_DEPARTMENT_ID=

ATHENA_DEFAULT_APPOINTMENTTYPE_ID=

ATHENA_OAUTH_SCOPE=athena/service/Athenanet.MDP.*

```



Verify and discover IDs:



```bash

cd middleware-platform

npm run verify:athena-token

npm run discover:athena-sandbox

npm run setup:phase3-athena

npm run verify:phase3-athena

npm run verify:athena-voice

```

**OAuth quota:** Preview limits token requests. If you see `Quota Exceeded`, wait 5–10 minutes and rerun only `npm run verify:phase3-athena`. Tokens are cached per `client_id` in `var/athena-oauth-cache.json` across npm commands (fixed: practice_id probes no longer request new tokens).

## Somo configuration



- Settings → PMS → **Connect Athena** (practice_id, department_id, client credentials)

- Or `PUT /api/admin/tenants/:clinicId/pms` with encrypted config

- Or `npm run setup:phase3-athena` (reads `.env` into pilot clinic)



Per-tenant `pms_config` fields: `client_id`, `client_secret`, `practice_id`, `department_id`, `default_appointmenttype_id`, `mirror_google: false`.



## Architecture



- Adapter: `middleware-platform/services/pms/athena-adapter.js`

- HTTP client: `middleware-platform/services/pms/athena-client.js`

- Local shadow appointments: `middleware-platform/services/pms/athena-shadow.js`

- Voice context flows through existing `PmsHub.getPatientContext` — no Kelly changes required



## Sandbox



- Preview base: `https://api.preview.platform.athenahealth.com`

- Evidence: `middleware-platform/var/evidence/phase3/athena-sandbox-acceptance.json`

