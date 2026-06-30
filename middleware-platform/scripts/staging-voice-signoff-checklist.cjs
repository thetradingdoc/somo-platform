#!/usr/bin/env node
'use strict';

/**
 * Print staging voice sign-off checklist (P8-6, P8-7). Ops fills runbook after execution.
 */
console.log(`
Voice staging sign-off — record results in docs/runbooks/VOICE_SCALE_READINESS.md

1. Live preflight
   STAGING_DB_PATH=./backups/middleware-staging.db \\
     API_BASE_URL=https://<staging-api> \\
     npm run preflight:operator-voice -- --live-api

2. Redis (if multi-instance)
   REDIS_URL=... npm run verify:voice-redis:fork
   curl -sS "$API_BASE_URL/health?detailed=true" | jq .voice_redis

3. Two-phone test — same tenant DID, two handsets, distinct callId in logs

4. 30-min soak — 2–5 concurrent calls; watch Groq 429, turn p95, WS disconnects

5. Mark P8 rows 4, 6, 7 in VOICE_SCALE_READINESS.md
`);
