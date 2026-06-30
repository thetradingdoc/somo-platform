# Voice scale readiness runbook

**Last updated:** 2026-06-30  
**Owner:** Middleware platform / voice (Kelly phone stack)

This runbook answers: **Can we claim high-volume, multi-replica phone handling is production-ready?**

See also: [`docs/voice/VOICE_ROUTING_ARCHITECTURE.md`](../voice/VOICE_ROUTING_ARCHITECTURE.md)

---

## Interpretations

| ID | Meaning | Status |
|----|---------|--------|
| **A** | Single-instance MVP — routing, billing gates, multi-call on one Node process | **Ready** |
| **B** | Fair limits — concurrent before admission, in-call turns, tier concurrent caps | **Ready** (automated tests) |
| **C** | Multi-replica shared limits via Redis | **Capped** until `REDIS_URL` on staging/prod (see below) |

Production **requires** `REDIS_URL` and `VOICE_RATE_LIMIT_BACKEND=redis` (default in `NODE_ENV=production`) before `min-instances > 1`.

---

## Limit types

| Limit | Where enforced | Key | Starter default |
|-------|----------------|-----|-----------------|
| `max_concurrent_calls` | Before admission + Retell register | `customer_id` | 2 simultaneous |
| `call_admission` | After concurrent pass, once per call | `customer_id` | 30 req/min |
| `turn_rate_limit` | Retell WS turn events only | `call_id` | 120/min (abuse guard) |

**Order:** concurrent cap → admission req/min → reserve slot → Retell. Busy callers do **not** burn req/min.

WS ping/pong and routine traffic **do not** increment admission counters.

---

## Test commands

```bash
cd middleware-platform

# Focused phone stack gate (~93 tests, fails if count drifts outside 85–120)
VOICE_RATE_LIMIT_BACKEND=memory npm run test:voice

# Load smoke (mocked Retell, no PSTN)
VOICE_RATE_LIMIT_BACKEND=memory npm run test:voice:load

# Redis sign-off (staging/prod — requires REDIS_URL)
REDIS_URL=redis://... npm run verify:voice-redis
REDIS_URL=redis://... npm run verify:voice-redis:fork

# Operator preflight (staging)
STAGING_DB_PATH=./backups/middleware-staging.db \
  API_BASE_URL=https://api.staging.example.com \
  npm run preflight:operator-voice -- --live-api

# Fix operator Somo branding (dev/staging DB)
node scripts/fix-operator-voice-openers.cjs --apply-db
```

---

## Redis provisioning (Interpretation C)

**Infra:** `REDIS_URL` is wired in `generate-cloudrun-env-yaml.cjs` (Secret Manager: `somo-staging-redis-url`). Provision Memorystore first, then deploy. Until healthy, run **single Cloud Run instance** only.

### Staging / prod checklist

1. Create **GCP Memorystore for Redis** in `us-central1` (same region as Cloud Run).
2. Allow VPC connector / authorized network for Cloud Run → Redis.
3. Set Cloud Run env (Secret Manager recommended):
   - `REDIS_URL=redis://:<password>@<host>:6379`
   - `VOICE_RATE_LIMIT_BACKEND=redis`
4. Deploy and verify:
   ```bash
   curl -sS "$API_BASE_URL/health?detailed=true" | jq '.voice_redis'
   ```
   Expect `status: healthy`.
5. Run fork test from a machine with network access to Redis:
   ```bash
   REDIS_URL=... npm run verify:voice-redis:fork
   ```
6. Only then set `min-instances > 1` on `somo-middleware`.

---

## Environment

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Shared admission + concurrent counters (required prod multi-replica) |
| `VOICE_RATE_LIMIT_BACKEND` | `redis` (prod) or `memory` (local dev) |
| `VOICE_ACTIVE_CALL_TTL_MIN` | Stale slot expiry (default 120) |
| `VOICE_TURN_RATE_LIMIT_MAX` | WS abuse ceiling (default 120/min) |
| `CLINIC_RATE_LIMIT_WINDOW_MS` | Admission window (default 60000) |
| `VOICE_TEST_MIN` / `VOICE_TEST_MAX` | Gate bounds for `run-voice-jest.cjs` (default 85–120) |

Health: `GET /health?detailed=true` → `voice_redis` probe.

---

## Cloud Run guidance

- Do **not** set `min-instances > 1` until Redis voice limits are deployed and healthy.
- `concurrency` (e.g. 30) bounds HTTP handlers per instance; active **calls** are capped separately per tenant tier.
- Safe envelope (starting point): ~10–20 concurrent Retell WS sessions per instance at concurrency=30; validate with staging soak.

---

## Data layer

- **Production:** voice call logs on **Postgres** (`migrate-voice-call-log-postgres.cjs`).
- **Dev:** SQLite acceptable; `SQLITE_BUSY` only acceptable locally.
- Hot indexes: migration `094_voice_call_log_indexes.js`.
- Twilio retries: CallSid dedupe via `voice:inbound:cache:{CallSid}`.

---

## Multi-line (Clinic Pro)

- Table: `customer_phone_numbers` (migration `095_customer_phone_numbers.js`).
- `getCustomerByTwilioNumber` resolves any registered E.164 → same tenant.
- Provisioning enforces `max_phone_numbers` from plan catalog.

### Non-goals (not supported)

- Hunt groups, hold music, PBX queues, enterprise call center features.

---

## Observability

Structured logs (JSON) on inbound/WS:

- `call_id`, `customer_id`, `rate_limit_outcome`, `concurrent_active`, `limit_type`

Metrics (via `services/metrics.js`):

- `voice.admissions.rejected.rate`
- `voice.admissions.rejected.concurrent`

### Alert thresholds (starting points)

- Spike in Groq 429 / admission rejections > 2× baseline for 5 min
- Redis `voice_redis.status=unhealthy` on `/health?detailed=true`
- Active call counter drift: Redis count >> audit table open rows

---

## Staging sign-off templates

### Live preflight (P8-7)

```bash
STAGING_DB_PATH=./backups/middleware-staging.db \
  API_BASE_URL=https://<staging-api> \
  npm run preflight:operator-voice -- --live-api
```

| Check | Pass? | Date | Owner |
|-------|-------|------|-------|
| Outbound opener mentions Somo | ☐ | | |
| Retell API not 403 | ☐ | | |
| Twilio checks green | ☐ | | |
| No duplicate operator DIDs | ☐ | | |

### Two-phone test (P8-6)

| Step | Pass? | Notes |
|------|-------|-------|
| Call tenant DID from phone A | ☐ | `callId` logged |
| Call same DID from phone B while A connected | ☐ | Distinct `callId` |
| Both conversations isolated (no cross-talk) | ☐ | |
| Sign-off engineer | | Date: |

### 30-minute soak (P8-6)

| Metric | Threshold | Actual | Pass? |
|--------|-----------|--------|-------|
| Concurrent calls | 2–5 | | ☐ |
| Groq 429 rate | < 1% turns | | ☐ |
| Turn p95 latency | < 3s | | ☐ |
| Retell WS disconnect rate | < 2% | | ☐ |
| Sign-off QA/Ops | | Date: | ☐ |

---

## Definition of done (P8 checklist)

| # | Criterion | Automated? | Status |
|---|-----------|------------|--------|
| 1 | ~93 tests green (`npm run test:voice`, 85–120 guard) | CI | ☑ |
| 2 | No mid-call admission limit on 15-min conversation | Jest | ☑ |
| 3 | `max_concurrent_calls` per tier | Jest + load smoke | ☑ |
| 4 | Redis shared limits in prod | Health + deploy | ☐ **Capped** — provision Redis, then verify |
| 5 | `test:voice:load` green | CI | ☑ |
| 6 | Staging two-phone + soak signed off | Manual | ☐ Ops |
| 7 | Live preflight green | Manual | ☐ Ops |
| 8 | Interpretation C ready or capped | This doc | ☑ **Capped** (single instance until Redis) |

---

## Not complete until

P8 rows 4, 6, and 7 are checked: Redis healthy on staging/prod, preflight + two-phone + soak signed off above.
