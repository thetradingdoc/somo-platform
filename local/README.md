# Local-only credentials (not committed)

## Database path (read first)

Dev SQLite SSoT: [`docs/Database/ENV_AND_DB_SSOT.md`](../docs/Database/ENV_AND_DB_SSOT.md).

From repo root [`run`](../run): `export DB_PATH=./middleware-dev.db` in `middleware-platform/`. Confirm at boot: log line `📁 Database path: …` or `GET /health?show_db_path=1`.

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
