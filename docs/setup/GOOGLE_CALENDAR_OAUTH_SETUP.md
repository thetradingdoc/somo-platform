# Google Calendar OAuth Setup Guide

## Important: This is a ONE-TIME Platform Setup

**This setup is done ONCE by DocLittle (the platform), NOT by each user.**

- ✅ **Platform Setup (One Time)**: DocLittle sets up one Google OAuth app
- ✅ **User Experience (Seamless)**: Users just click "Connect" and authorize
- ✅ **Automatic Syncing**: DocLittle handles all calendar syncing automatically

---

## For DocLittle Platform Administrators

### Step 1: Create a Google Cloud Project (One Time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top
3. Click "New Project"
4. Enter a project name (e.g., "DocLittle Calendar Integration")
5. Click "Create"

### Step 2: Enable Google Calendar API (One Time)

1. In the Google Cloud Console, go to **APIs & Services** > **Library**
2. Search for "Google Calendar API"
3. Click on it and click **Enable**

### Step 3: Configure OAuth Consent Screen (One Time)

1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose **External** (for public use) or **Internal** (for Google Workspace)
3. Fill in:
   - App name: "DocLittle"
   - User support email: Your support email
   - Developer contact: Your email
4. Click **Save and Continue**
5. **Scopes**: Click **Add or Remove Scopes**, search for "calendar", select:
   - `https://www.googleapis.com/auth/calendar`
   - Click **Update** > **Save and Continue**
6. **Test users**: Add your email (for External apps in testing)
7. Click **Save and Continue** > **Back to Dashboard**

### Step 4: Create OAuth 2.0 Credentials (One Time)

1. Go to **APIs & Services** > **Credentials**
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
3. Application type: **Web application**
4. Name: "DocLittle Calendar Integration"
5. **Authorized redirect URIs**: Add:
   ```
   http://localhost:4000/auth/google/calendar/callback
   ```
   For production, also add:
   ```
   https://your-production-domain.com/auth/google/calendar/callback
   ```
6. Click **Create**
7. **Copy the credentials**:
   - **Client ID**: Copy this value
   - **Client secret**: Copy this value (click "Show" if needed)

### Step 5: Configure Environment Variables (One Time)

1. Open `middleware-platform/.env`
2. Add/update:
   ```env
   GOOGLE_CLIENT_ID=your-actual-client-id-here
   GOOGLE_CLIENT_SECRET=your-actual-client-secret-here
   GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/calendar/callback
   ```

3. For production, update `GOOGLE_REDIRECT_URI` to your production domain

### Step 6: Restart the Server

```bash
cd middleware-platform
# Stop the current server (Ctrl+C)
npm start
```

---

## For End Users (Providers)

### User Experience: One-Click Connection

1. **Go to Settings** → Connected Services
2. **Click "Connect Google Calendar"**
3. **Authorize** on Google's OAuth screen (one click)
4. **Done!** Calendar is now synced automatically

That's it! No setup, no configuration, no technical knowledge required.

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  DocLittle Platform (One OAuth App)                     │
│  - Single Google OAuth credentials                      │
│  - Handles all OAuth flows                              │
│  - Stores tokens per user                               │
└─────────────────────────────────────────────────────────┘
                        │
                        │ OAuth Flow
                        ▼
┌─────────────────────────────────────────────────────────┐
│  User 1: provider@doclittle.com                        │
│  - Clicks "Connect"                                     │
│  - Authorizes on Google                                 │
│  - DocLittle stores refresh token                       │
│  - Calendar syncs automatically                        │
└─────────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────────┐
│  User 2: another@doclittle.com                         │
│  - Clicks "Connect"                                     │
│  - Authorizes on Google                                 │
│  - DocLittle stores refresh token                       │
│  - Calendar syncs automatically                        │
└─────────────────────────────────────────────────────────┘
```

### Automatic Syncing

Once connected, DocLittle automatically:
- ✅ Checks calendar availability when scheduling appointments
- ✅ Creates calendar events for new appointments
- ✅ Updates calendar events when appointments change
- ✅ Deletes calendar events when appointments are cancelled
- ✅ Refreshes tokens automatically (no user action needed)
- ✅ Handles errors and reconnection seamlessly

### Token Management

- **Refresh tokens** are stored securely per user
- **Access tokens** are refreshed automatically when expired
- **No user action required** for token management
- **Automatic reconnection** if tokens expire

---

## Production Checklist

- [ ] OAuth consent screen published (for External apps)
- [ ] Production redirect URI added to Google Cloud Console
- [ ] `GOOGLE_REDIRECT_URI` updated in production `.env`
- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set in production
- [ ] Server restarted with new credentials
- [ ] Test connection from production domain

---

## Troubleshooting

### "Google OAuth is not configured on the server"
- Make sure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `.env`
- Restart the server after updating `.env`

### "Redirect URI mismatch"
- The redirect URI in Google Cloud Console must exactly match:
  - `http://localhost:4000/auth/google/calendar/callback` (local)
  - Or your production URL (production)
- Check for trailing slashes or typos

### "Access blocked: This app's request is invalid"
- For External apps: Add your email as a test user in OAuth consent screen
- For production: Publish the OAuth consent screen

---

## Security Notes

- ✅ **One OAuth app** for entire platform (managed by DocLittle)
- ✅ **Tokens stored per user** (isolated and secure)
- ✅ **Automatic token refresh** (no user action needed)
- ✅ **Never commit `.env`** to version control
- ✅ **Use different credentials** for dev/production
- ✅ **Rotate credentials** if compromised

---

## Summary

**Platform Setup (One Time)**: ~15 minutes
- Create Google Cloud project
- Enable Calendar API
- Configure OAuth
- Add credentials to `.env`

**User Experience**: One click
- Click "Connect"
- Authorize
- Done!

**Ongoing**: Fully automatic
- Syncing
- Token management
- Error handling
