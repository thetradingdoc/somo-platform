# ⚡ QUICK FIX: Google OAuth Error

## Problem
Error 400: "invalid_client" - The OAuth client was not found

## Solution
Your `.env` file has placeholder values. You need real Google OAuth credentials.

## Steps (5 minutes):

1. **Go to**: https://console.cloud.google.com/
2. **Create project**: "DocLittle"
3. **Enable**: Google Calendar API
4. **Create OAuth credentials**:
   - APIs & Services → Credentials → Create OAuth Client ID
   - Type: Web application
   - Redirect URI: `http://localhost:4000/auth/google/calendar/callback`
5. **Copy** Client ID and Client Secret
6. **Update** `middleware-platform/.env`:
   ```
   GOOGLE_CLIENT_ID=your-actual-client-id
   GOOGLE_CLIENT_SECRET=your-actual-client-secret
   ```
7. **Restart** server

See `docs/setup/QUICK_GOOGLE_OAUTH_SETUP.md` for detailed steps.
