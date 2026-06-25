# Local-only credentials (not committed)

## GCP CLI / ADC

For `somo-callsomo`, use **`richard@callsomo.com`** for `gcloud` and for Application Default Credentials (ADC). See [CALLSOMO_GCP_CUTOVER.md](../docs/runbooks/CALLSOMO_GCP_CUTOVER.md#local-gcloud-and-adc).

## Database path (read first)

Dev SQLite SSoT: [`docs/Database/ENV_AND_DB_SSOT.md`](../docs/Database/ENV_AND_DB_SSOT.md).

From repo root [`run`](../run): `export DB_PATH=./middleware-dev.db` in `middleware-platform/`. Confirm at boot: log line `📁 Database path: …` or `GET /health?show_db_path=1`.

## Local URLs on port 4000

Default (`LOCAL_DEV_ROOT=health` in `.env.example` and `./run`):

| URL | Purpose |
|-----|---------|
| `http://localhost:4000/` | **Safe VideoGPT for Healthcare** (redirect → `/health-video.html`) |
| `http://localhost:4000/health-video.html` | Health MVP direct |
| `http://localhost:4000/login` | Provider portal sign-in |
| `http://localhost:4000/business/today.html` | Provider Today dashboard (after login) |
| `http://localhost:4000/health` | API health check |

**One command:** from repo root `./run` or `cd middleware-platform && npm start` — single Node process, no ngrok for health.

**Voice / Retell webhooks** use production `https://api.callsomo.com` — no local tunnel required for health MVP.

**Provider work only:** set `LOCAL_DEV_ROOT=login` in `middleware-platform/.env` so `/` redirects to login (remove `LOCAL_DEV_ROOT=health` if set).

**Optional server STT (advanced):** `npm run health:stt-agent` in `middleware-platform/` — requires `DEEPGRAM_API_KEY`; default health MVP uses browser speech instead.

**Faster API startup:** `npm run start:landing` in `middleware-platform/` (skips heavy background workers; `DEV_LIGHT_START=1`).

**Landing-only Vite dev server:** `npm run dev:somo-landing` (port 5180, proxies API to `:4000`).

## Provider sign-in (Somo portal)

1. Copy the template:
   ```bash
   cp local/provider-login.credentials.example local/provider-login.credentials
   ```
2. Edit `local/provider-login.credentials` with your work email and password.
3. Optionally mirror the same values in `middleware-platform/.env`:
   ```bash
   SOMO_OWNER_EMAIL=you@yourcompany.com
   SOMO_OWNER_PASSWORD=your-secure-password
   SOMO_OWNER_CLINIC_PHONE=+15551234567
   ```

## Apply account to the database

From `middleware-platform/`:

```bash
npm run ensure:somo-owner
```

This creates or updates the provider customer, verifies email, and sets the password hash. Then sign in at:

http://localhost:4000/login

## Manual alternative

Create a new provider tenant:

```bash
cd middleware-platform
node scripts/create-web-provider-account.js \
  --email=you@company.com \
  --name="Your Name" \
  --password='YourSecurePass8+' \
  --clinic-name="Your Clinic" \
  --phone=+15551234567
```

`local/provider-login.credentials` is listed in `.gitignore` — do not commit it.
