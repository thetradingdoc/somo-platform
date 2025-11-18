# Quick Google OAuth Setup (5 Minutes)

## The Error You're Seeing

**Error 400: "invalid_client"** means the Google OAuth Client ID doesn't exist or is incorrect.

This happens because your `.env` file has placeholder values:
```
GOOGLE_CLIENT_ID=your-google-client-id-here  ❌
GOOGLE_CLIENT_SECRET=your-google-client-secret-here  ❌
```

## Quick Fix (5 Minutes)

### Step 1: Go to Google Cloud Console (2 minutes)

1. Open: https://console.cloud.google.com/
2. Click the project dropdown (top left)
3. Click **"New Project"**
4. Name it: **"DocLittle"**
5. Click **"Create"**

### Step 2: Enable Calendar API (30 seconds)

1. In the search bar at the top, type: **"Calendar API"**
2. Click **"Google Calendar API"**
3. Click **"Enable"**

### Step 3: Create OAuth Credentials (2 minutes)

1. Click the hamburger menu (☰) → **APIs & Services** → **Credentials**
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. If prompted to configure consent screen:
   - **User Type**: Choose **"External"**
   - Click **"Create"**
   - **App name**: "DocLittle"
   - **User support email**: Your email
   - **Developer contact**: Your email
   - Click **"Save and Continue"** (3 times)
   - **Test users**: Add your email
   - Click **"Save and Continue"** → **"Back to Dashboard"**

4. Now create the OAuth client:
   - **Application type**: **"Web application"**
   - **Name**: "DocLittle Calendar"
   - **Authorized redirect URIs**: Click **"+ ADD URI"**
   - Paste: `http://localhost:4000/auth/google/calendar/callback`
   - Click **"Create"**

5. **Copy the credentials**:
   - **Client ID**: Copy this (looks like: `123456789-abc.apps.googleusercontent.com`)
   - **Client secret**: Click "Show" and copy this

### Step 4: Update .env File (30 seconds)

1. Open: `middleware-platform/.env`
2. Replace the placeholder values:

```env
GOOGLE_CLIENT_ID=paste-your-actual-client-id-here
GOOGLE_CLIENT_SECRET=paste-your-actual-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/calendar/callback
```

3. Save the file

### Step 5: Restart Server (10 seconds)

```bash
cd middleware-platform
# Stop server (Ctrl+C if running)
npm start
```

## Test It

1. Go to Settings → Connected Services
2. Click **"Connect Google Calendar"**
3. You should see Google's authorization screen (not an error!)

## Common Issues

### "Redirect URI mismatch"
- Make sure the redirect URI in Google Cloud Console **exactly** matches:
  - `http://localhost:4000/auth/google/calendar/callback`
- No trailing slashes, no typos

### "Access blocked"
- Add your email as a **Test user** in OAuth consent screen
- Go to: APIs & Services → OAuth consent screen → Test users → Add

### Still getting errors?
- Make sure you **restarted the server** after updating `.env`
- Check that there are **no spaces** around the `=` in `.env`
- Verify the Client ID and Secret are correct (no extra characters)

## That's It!

Once you have real credentials in `.env` and restart the server, the OAuth flow will work perfectly. Users will just click "Connect" and authorize - that's it!

