# Google OAuth & Calendar Integration - Complete Guide

**Last Updated**: January 2025  
**Status**: Production Ready

---

## 📋 Overview

This guide covers the complete setup and usage of Google OAuth for Calendar integration in DocLittle. This is a **one-time platform setup** done by DocLittle administrators, not by individual users.

### Key Points

- ✅ **Platform Setup (One Time)**: DocLittle sets up one Google OAuth app
- ✅ **User Experience (Seamless)**: Users just click "Connect" and authorize
- ✅ **Automatic Syncing**: DocLittle handles all calendar syncing automatically
- ✅ **Multi-Tenant Support**: One OAuth app serves all clinics/tenants

---

## 🚀 Quick Setup (5 Minutes)

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
   - For **Local Development**: `http://localhost:4000/auth/google/calendar/callback`
   - For **Production**: `https://api.doclittle.site/auth/google/calendar/callback`
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

## ✅ Test It

1. Go to Settings → Connected Services
2. Click **"Connect Google Calendar"**
3. You should see Google's authorization screen (not an error!)

---

## 📖 Detailed Setup Guide

### For DocLittle Platform Administrators

#### Step 1: Create a Google Cloud Project (One Time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top
3. Click "New Project"
4. Enter a project name (e.g., "DocLittle Calendar Integration")
5. Click "Create"

#### Step 2: Enable Google Calendar API (One Time)

1. In the Google Cloud Console, go to **APIs & Services** > **Library**
2. Search for "Google Calendar API"
3. Click on it and click **Enable**

#### Step 3: Configure OAuth Consent Screen (One Time)

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

#### Step 4: Create OAuth 2.0 Credentials (One Time)

1. Go to **APIs & Services** > **Credentials**
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
3. Application type: **Web application**
4. Name: "DocLittle Calendar Integration"
5. **Authorized redirect URIs**: Add:
   - `http://localhost:4000/auth/google/calendar/callback` (development)
   - `https://api.doclittle.site/auth/google/calendar/callback` (production)
6. Click **Create**
7. **Copy and save**:
   - Client ID
   - Client Secret

#### Step 5: Configure Environment Variables

**Development (.env file):**
```env
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/calendar/callback
```

**Production (Azure App Settings):**
```bash
az webapp config appsettings set \
  --resource-group doclittle \
  --name doclittle \
  --settings \
    GOOGLE_CLIENT_ID=your-client-id-here \
    GOOGLE_CLIENT_SECRET=your-client-secret-here \
    GOOGLE_REDIRECT_URI=https://api.doclittle.site/auth/google/calendar/callback
```

---

## 👥 User Experience

### How Users Connect Google Calendar

1. **User navigates to Settings** → **Connected Services**
2. **Clicks "Connect Google Calendar"** button
3. **Redirected to Google** authorization screen
4. **Clicks "Allow"** to grant permissions
5. **Automatically redirected back** to DocLittle
6. **Calendar is now connected** ✅

### What Happens Behind the Scenes

1. User clicks "Connect" → DocLittle redirects to Google OAuth
2. Google shows consent screen → User authorizes
3. Google redirects back with authorization code
4. DocLittle exchanges code for access token
5. DocLittle stores token securely in database
6. Calendar integration is active

### Automatic Calendar Syncing

Once connected:
- ✅ Appointments created in DocLittle → Automatically added to Google Calendar
- ✅ Appointments updated in DocLittle → Automatically updated in Google Calendar
- ✅ Appointments cancelled in DocLittle → Automatically removed from Google Calendar
- ✅ Calendar events include all appointment details (patient, time, type, etc.)

---

## 🏢 Multi-Tenant Architecture

### How It Works

**One OAuth App for All Tenants:**
- DocLittle uses a single Google OAuth application
- Each clinic/tenant connects their own Google account
- Each connection is stored separately in the database
- Each tenant's calendar is synced independently

### Database Structure

```sql
-- Each user has their own calendar connection
ehr_connections (
  id,
  provider_id,        -- User ID
  ehr_name,           -- 'google_calendar'
  access_token,       -- Encrypted OAuth token
  refresh_token,      -- For token renewal
  expires_at,         -- Token expiration
  connected_at
)
```

### Tenant Isolation

- ✅ Each clinic connects their own Google account
- ✅ Calendar events are isolated per tenant
- ✅ No cross-tenant data access
- ✅ Each tenant manages their own calendar

### Token Management

- **Access Tokens**: Stored encrypted in database
- **Refresh Tokens**: Automatically used to renew expired tokens
- **Token Expiration**: Handled automatically by DocLittle
- **Revocation**: Users can disconnect anytime

---

## 🐛 Troubleshooting

### Common Issues

#### "Redirect URI mismatch"

**Error**: `redirect_uri_mismatch`

**Cause**: The redirect URI in Google Cloud Console doesn't match the one in your code.

**Fix**:
1. Check Google Cloud Console → Credentials → OAuth Client
2. Verify redirect URI **exactly** matches:
   - Development: `http://localhost:4000/auth/google/calendar/callback`
   - Production: `https://api.doclittle.site/auth/google/calendar/callback`
3. No trailing slashes, no typos
4. Save and wait 5 minutes for changes to propagate

#### "Access blocked"

**Error**: `access_denied` or "This app isn't verified"

**Cause**: OAuth consent screen not configured or user not added as test user.

**Fix**:
1. Go to Google Cloud Console → OAuth consent screen
2. If app is in "Testing" mode, add user email to **Test users**
3. If app needs verification, submit for verification (or use internal app type)

#### "Invalid client"

**Error**: `invalid_client`

**Cause**: Client ID or Client Secret is incorrect in `.env` file.

**Fix**:
1. Check `.env` file has correct values
2. No spaces around `=` sign
3. No quotes needed (unless value has spaces)
4. Restart server after updating `.env`

#### "Token expired"

**Error**: Calendar sync stops working

**Cause**: Access token expired and refresh failed.

**Fix**:
1. Check database for `expires_at` timestamp
2. Verify `refresh_token` is stored
3. Check logs for refresh token errors
4. User may need to reconnect

#### Still getting errors?

1. **Verify server restarted** after updating `.env`
2. **Check environment variables** are loaded:
   ```bash
   # In Node.js console
   console.log(process.env.GOOGLE_CLIENT_ID)
   ```
3. **Check redirect URI** matches exactly (case-sensitive)
4. **Verify OAuth consent screen** is configured
5. **Check Google Cloud Console** for any error messages

---

## 🔒 Security Best Practices

### Token Storage

- ✅ Access tokens stored encrypted in database
- ✅ Refresh tokens stored securely
- ✅ Tokens never logged or exposed in URLs
- ✅ HTTPS required for production

### OAuth Flow Security

- ✅ State parameter used to prevent CSRF attacks
- ✅ Authorization codes exchanged server-side only
- ✅ Tokens never exposed to client-side JavaScript
- ✅ Secure redirect URIs (no wildcards)

### Multi-Tenant Security

- ✅ Each tenant's tokens isolated
- ✅ No cross-tenant token access
- ✅ User can only access their own calendar
- ✅ Proper authentication checks

---

## 📊 Monitoring & Maintenance

### Check Connection Status

```sql
-- View all connected users
SELECT 
  provider_id,
  ehr_name,
  connected_at,
  expires_at
FROM ehr_connections
WHERE ehr_name = 'google_calendar';
```

### Monitor Token Expiration

```sql
-- Find tokens expiring soon
SELECT 
  provider_id,
  expires_at,
  DATEDIFF(expires_at, NOW()) as days_until_expiry
FROM ehr_connections
WHERE ehr_name = 'google_calendar'
  AND expires_at < DATE_ADD(NOW(), INTERVAL 7 DAY);
```

### Handle Disconnections

Users can disconnect anytime:
1. Go to Settings → Connected Services
2. Click "Disconnect Google Calendar"
3. Token is revoked and removed from database
4. Calendar syncing stops

---

## 🔗 Related Documentation

- **API Documentation**: `docs/api/API_DOCUMENTATION.md`
- **Deployment Guide**: `docs/deployment/guides/DEPLOYMENT_GUIDE.md`
- **Multi-Tenant Architecture**: `docs/architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md`

---

## ✅ Setup Checklist

Before going live:

- [ ] Google Cloud Project created
- [ ] Calendar API enabled
- [ ] OAuth consent screen configured
- [ ] OAuth credentials created
- [ ] Redirect URIs added (dev + prod)
- [ ] Environment variables set
- [ ] Test connection works locally
- [ ] Production redirect URI added
- [ ] Production environment variables set
- [ ] Test connection works in production
- [ ] Token refresh tested
- [ ] Calendar sync tested
- [ ] Multi-tenant isolation verified

---

**Status**: ✅ Production Ready  
**Last Updated**: January 2025

