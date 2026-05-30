# Environment and database single source of truth

> **Last reviewed:** 2026-05-29  
> **Audience:** Anyone running middleware locally or debugging tenant/voice issues.

## SQLite file resolution

The active database path is chosen in [`middleware-platform/database.js`](../../middleware-platform/database.js) at process start. Look for this log line:

```text
📁 Database path: /absolute/path/to/middleware-dev.db (environment: development)
```

### Variables (priority order)

| Variable | Purpose | Dev typical | Prod typical |
|----------|---------|-------------|--------------|
| `DB_PATH` | **Highest priority** — absolute or cwd-relative path to the `.db` file | `./middleware-dev.db` (see repo [`run`](../../run)) | Set explicitly on App Service |
| `DB_NAME` | Filename only when `DB_PATH` unset | *(unset → `middleware-dev.db`)* | `middleware-prod.db` |
| `NODE_ENV` | Selects default filename when `DB_NAME` unset | `development` | `production` |
| `POSTGRES_URL` | Optional Postgres pool + sync mirror (not full SQLite replacement) | Usually unset | Set when using managed Postgres |
| `SKIP_STARTUP_MIGRATIONS` | Skip inline `migrate*()` batch in `database.js` | `1` for one-off scripts only | Do not set |
| `SQLITE_BUSY_TIMEOUT_MS` | Writer lock wait (default 60000) | Default | Default or raise under load |

### Dev quick start (canonical)

From repo root [`run`](../../run):

```bash
cd middleware-platform
export DB_PATH=./middleware-dev.db
npm start
```

The file is resolved with `path.resolve(process.cwd(), DB_PATH)` — run middleware from `middleware-platform/` so the DB lives beside `package.json`.

### Verify path at runtime

```bash
curl -s 'http://localhost:4000/health?show_db_path=1' | jq .database_path
```

## Postgres (optional)

When `POSTGRES_URL` is set:

- Startup logs: `🗄️  POSTGRES_URL detected – Postgres pool initialized`
- SQLite remains the primary write path for most domains; selected entities sync via `postgres_sync_retry` / DLQ (see [DB_STRUCTURE_AND_PIPELINE.md](./DB_STRUCTURE_AND_PIPELINE.md)).

## Voice and telephony environment checklist (D1-04)

Use this when inbound calls fail, Retell never connects, or settings land on the wrong merchant.

### Required for Week 1 gate (owner inbound + landing demo)

| Variable | Required | Role |
|----------|----------|------|
| `TWILIO_ACCOUNT_SID` | Yes (voice) | Twilio REST + webhook validation |
| `TWILIO_AUTH_TOKEN` | Yes | Signature validation on `/voice/incoming` |
| `API_BASE_URL` or `NGROK_URL` | Yes (dev) | Public HTTPS URL Twilio/Retell reach; dev: ngrok → `https://….ngrok-free.app` |
| `RETELL_API_KEY` | Yes | Agent create/update, runtime API |
| `RETELL_AGENT_ID` | Per-tenant | Often on `customers.retell_agent_id`; global fallback in env |
| `SOMO_OWNER_EMAIL` / `SOMO_OWNER_PASSWORD` | Dev login | See [`local/README.md`](../../local/README.md) |
| `SOMO_OWNER_CLINIC_PHONE` | Create owner | E.164 when account does not exist |

### Strongly recommended

| Variable | Role |
|----------|------|
| `RETELL_WEBHOOK_SECRET` | Validates Retell → middleware callbacks |
| `RETELL_VOICE_ID` | Default TTS voice for new agents |
| `TWILIO_WEBHOOK_SIGNATURE_REQUIRED` | `1` in production |
| `BASE_URL` | Fallback when `API_BASE_URL` unset (links in email/SMS) |

### Billing / trial (signup and SIM flow)

| Variable | Role |
|----------|------|
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Subscriptions, trial conversion |
| `TRIAL_SIM_FLOW_ENABLED` | Trial phone provisioning |
| `TWILIO_VERIFY_SERVICE_SID` | OTP for `phone_verified` |

### Public URL resolution order (code)

Middleware prefers: `PUBLIC_BASE_URL` → `API_BASE_URL` → `BASE_URL` → Railway host → localhost. Trial lifecycle also reads `NGROK_URL` when `API_BASE_URL` is not public HTTPS.

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](./SOMO_FOUNDATION_RUNBOOK.md) — Day 1–5 operational steps
- [`middleware-platform/.env.example`](../../middleware-platform/.env.example) — commented template
- [TENANT_MODEL.md](./TENANT_MODEL.md) — `customers` vs `merchants` vs `clinics`
