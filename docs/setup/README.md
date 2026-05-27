# setup — consolidated documentation

**Single file:** All former `docs/setup/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Complete Setup Guide - DocLittle Platform (`getting-started/SETUP.md`)](#getting-started-setup)
- [Google OAuth & Calendar Integration - Complete Guide (`google/GOOGLE_OAUTH_COMPLETE_GUIDE.md`)](#google-google-oauth-complete-guide)
- [Google Calendar Integration - User Experience (`google/oauth/GOOGLE_CALENDAR_USER_EXPERIENCE.md`)](#google-oauth-google-calendar-user-experience)
- [Multi-Tenant Google OAuth Setup (`google/oauth/MULTI_TENANT_GOOGLE_OAUTH.md`)](#google-oauth-multi-tenant-google-oauth)
- [Setup Documentation (`README.md`)](#readme)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="getting-started-setup"></a>

## Complete Setup Guide - DocLittle Platform

*Former path: `docs/setup/getting-started/SETUP.md`*

This is the **only setup document** you need. It covers everything from initial setup to troubleshooting.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Environment Variables](#environment-variables)
3. [Local Development](#local-development)
4. [Production Deployment](#production-deployment)
5. [Domain Configuration](#domain-configuration)
6. [Voice Agent Setup](#voice-agent-setup)
7. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+ (install via nvm: `nvm install node`)
- Git repository cloned
- API keys for: Retell AI, Twilio, Stripe (optional), Circle (optional)

### Initial Setup

```bash
# 1. Install dependencies
cd middleware-platform
npm install

# 2. Create .env file
cp .env.example .env  # Or create manually

# 3. Add your API keys to .env (see Environment Variables section)

# 4. Start local server
npm start
```

---

## 🔧 Environment Variables

### Required Variables

```bash
# Server Configuration
PORT=4000
NODE_ENV=development  # or 'production'

# Retell AI (Voice Agent)
RETELL_API_KEY=your_retell_api_key
RETELL_AGENT_ID=agent_9151f738c705a56f4a0d8df63a

# Twilio (Phone Calls)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# API Base URL (for production - use your deployed URL)
API_BASE_URL=https://your-app.azurewebsites.net
# Or for local development with tunnel:
# API_BASE_URL=https://your-tunnel-url.com
```

### Optional Variables

```bash
# Stripe (Payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Circle (USDC Wallets) - Optional, server works without it
CIRCLE_API_KEY=your_circle_api_key
CIRCLE_ENTITY_SECRET=your_entity_secret

# Database
DATABASE_PATH=./database.sqlite

# Email (SMTP or Azure)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password

# Or Azure Communication Services
AZURE_COMMUNICATION_CONNECTION_STRING=endpoint=...
AZURE_EMAIL_SENDER=DoNotReply@your-domain.com
```

### Where to Set Variables

**Local Development:**
- File: `middleware-platform/.env`
- Create this file manually

**Production (Railway):**
- Railway Dashboard → Your Service → Variables
- Add each variable as `KEY=value`

---

## 💻 Local Development

### Running Locally

```bash
# Option 1: Use the start script
./scripts/root/start-local.sh

# Option 2: Manual start
cd middleware-platform
npm start
```

### Exposing Local Server to Internet (for Testing)

To test with Retell/Twilio, you need to expose your local server:

#### Option A: Cloudflare Tunnel (Recommended - Free)

```bash
# Install
brew install cloudflare/cloudflare/cloudflared

# Run tunnel (in separate terminal)
cloudflared tunnel --url http://localhost:4000

# Copy the URL (e.g., https://abc123.trycloudflare.com)
# Use this URL for Retell/Twilio webhooks
```

#### Option B: ngrok (Alternative)

```bash
# Install and sign up at ngrok.com
brew install ngrok/ngrok/ngrok
ngrok config add-authtoken YOUR_TOKEN

# Run tunnel
ngrok http 4000

# Copy the URL (e.g., https://abc123.ngrok-free.app)
```

#### Option C: localtunnel (Simplest)

```bash
npm install -g localtunnel
lt --port 4000
```

### Updating Retell/Twilio for Local Testing

1. **Get your tunnel URL** (from above)
2. **Update Retell:**
   ```bash
   API_BASE_URL=https://your-tunnel-url.com node middleware-platform/configure-retell.js
   ```
3. **Update Twilio:**
   - Go to: https://console.twilio.com/
   - Phone Numbers → Your Number → Voice & Fax
   - Set "A CALL COMES IN" to: `https://your-tunnel-url.com/voice/incoming`

---

## 🚀 Production Deployment

### Railway Deployment

1. **Connect GitHub to Railway:**
   - Railway Dashboard → New Project → Deploy from GitHub
   - Select your repository

2. **Set Environment Variables:**
   - Railway Dashboard → Your Service → Variables
   - Add all required variables (see Environment Variables section)
   - **Important**: Set `API_BASE_URL=https://web-production-a783d.up.railway.app`

3. **Deploy:**
   - Railway auto-deploys on git push
   - Check logs for deployment status

### Backend URL

- **Railway URL**: `https://web-production-a783d.up.railway.app`
- **Custom Domain** (optional): `api.doclittle.site` (if configured)

### Frontend URL

- **Netlify URL**: `https://doclittle.netlify.app`
- **Custom Domain**: `https://doclittle.site`

---

## 🌐 Domain Configuration

### Current Setup

- **Domain**: `doclittle.site` (registered with IONOS)
- **Frontend**: Hosted on Netlify
- **Backend**: Hosted on Railway
- **DNS**: Managed by Netlify (nameservers: `dns1-4.p06.nsone.net`)

### Connecting Domain to Netlify

1. **Update Nameservers in IONOS:**
   - Go to: https://my.ionos.com/domain-dns-settings/doclittle.site
   - Change nameservers to Netlify's:
     ```
     dns1.p06.nsone.net
     dns2.p06.nsone.net
     dns3.p06.nsone.net
     dns4.p06.nsone.net
     ```

2. **Add Domain in Netlify:**
   - Netlify Dashboard → Site Settings → Domain management
   - Click "Add domain alias"
   - Enter: `doclittle.site`
   - Wait for DNS verification (5-10 minutes)

3. **Wait for SSL:**
   - Netlify auto-provisions SSL certificates
   - Check: Domain Settings → HTTPS
   - Should show "Certificate provisioned"

### DNS Records

Netlify automatically manages:
- A records (for root domain)
- AAAA records (IPv6)
- CNAME records (for www subdomain)

**No manual DNS configuration needed** - Netlify handles it automatically.

---

## 🎙️ Voice Agent Setup

### Retell Configuration

1. **Configure Retell Agent:**
   ```bash
   cd middleware-platform
   node configure-retell.js
   ```

2. **This sets:**
   - LLM WebSocket URL: `wss://your-backend-url.com/webhook/retell/llm`
   - Agent name: "Kelly - DocLittle Medical Voice Assistant"
   - Functions: All healthcare functions (collect_insurance, schedule_appointment, etc.)

3. **Verify in Retell Dashboard:**
   - Go to: https://dashboard.retellai.com/
   - Check agent settings
   - Verify WebSocket URL is correct

### Twilio Configuration

1. **Get Phone Number:**
   - Twilio Console → Phone Numbers → Buy a number
   - Or use existing: `+15856202445`

2. **Set Voice Webhook:**
   - Phone Numbers → Your Number → Voice & Fax
   - **A CALL COMES IN**: `https://web-production-a783d.up.railway.app/voice/incoming`
   - **HTTP Method**: POST
   - Save

3. **For Local Testing:**
   - Use tunnel URL: `https://your-tunnel-url.com/voice/incoming`

### Testing Voice Calls

1. **Make a test call:**
   - Call your Twilio number
   - Should connect to voice agent

2. **Check logs:**
   - Railway logs (production) or local terminal (development)
   - Should see: `📞 INCOMING CALL from Twilio`

3. **Common issues:**
   - 404 error: Webhook URL is wrong
   - Timeout: Server not responding (check if running)
   - No answer: Twilio can't reach server

---

## 🔍 Troubleshooting

### Server Won't Start

**Error: "Cannot find module './middleware/security'"**
- **Fix**: Make sure all files are committed to git
- **Check**: `git status` - should show no untracked files in `middleware-platform/middleware/`

**Error: "Node.js is not installed"**
- **Fix**: Install Node.js via nvm: `nvm install node`
- **Or**: Use the start script which loads nvm automatically

**Error: "Port 4000 already in use"**
- **Fix**: Kill the process: `kill -9 $(lsof -ti:4000)`
- **Or**: Use a different port: `PORT=4001 npm start`

### Login page is slow on localhost

If `http://localhost:4000/login` loads slowly right after starting the server, it is usually a **cold start** issue (startup migrations + boot tasks), not the login page itself.

- **Recommended local flags** (speed up startup):
  - `DEV_LIGHT_START=1` — skips post-listen background workers
  - `SKIP_STARTUP_MIGRATIONS=1` — skips the large startup migration batch (useful for local dev scripts/eval)
- **Also check**: external asset fetches (e.g. `fonts.googleapis.com`) can stall page rendering on some networks.

### Voice Agent Not Connecting

**Error: "11200 - HTTP 404"**
- **Problem**: Twilio webhook URL is wrong
- **Fix**: Update Twilio webhook to Railway backend URL:
  - `https://web-production-a783d.up.railway.app/voice/incoming`
  - NOT `https://doclittle.site/voice/incoming` (that's frontend)

**Error: "11205 - Request timed out"**
- **Problem**: Server taking too long to respond
- **Fix**: 
  - Check if server is running
  - Check Railway logs for errors
  - Verify Retell API key is correct

**Error: "No Answer"**
- **Problem**: Twilio can't reach server
- **Fix**:
  - Check webhook URL is correct
  - Verify server is running
  - Check firewall/network settings

### Domain Not Loading

**Error: "404 Not Found" on doclittle.site**
- **Problem**: Domain not connected to Netlify site
- **Fix**:
  1. Netlify Dashboard → Site Settings → Domain management
  2. Click "Add domain alias"
  3. Enter: `doclittle.site`
  4. Wait for DNS verification

**Error: "SSL Certificate Error"**
- **Problem**: SSL not provisioned yet
- **Fix**: Wait 5-10 minutes after adding domain, Netlify auto-provisions SSL

### Circle Wallet Issues

**Warning: "CIRCLE_API_KEY not set"**
- **Status**: This is OK - server works without Circle
- **Fix**: Only needed if you want wallet features
- **To enable**: Add `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` to environment variables

**Error: "Circle service not available"**
- **Problem**: Circle API keys missing or invalid
- **Fix**: 
  - Check API keys are correct
  - Verify keys are in environment variables
  - Server will continue without Circle (wallet features disabled)

### Database Issues

**Error: "Database locked"**
- **Problem**: Multiple processes accessing database
- **Fix**: 
  - Kill other server processes
  - Restart server
  - Check for concurrent database access

**Error: "Database file not found"**
- **Problem**: Database path incorrect
- **Fix**: 
  - Check `DATABASE_PATH` in `.env`
  - Default: `./database.sqlite` (relative to server.js)

---

## 📚 Quick Reference

### Important URLs

- **Backend (Railway)**: `https://web-production-a783d.up.railway.app`
- **Frontend (Netlify)**: `https://doclittle.site`
- **Retell Dashboard**: https://dashboard.retellai.com/
- **Twilio Console**: https://console.twilio.com/
- **Railway Dashboard**: https://railway.app/
- **Netlify Dashboard**: https://app.netlify.com/

### Important Endpoints

- **Health Check**: `GET /health`
- **Voice Incoming**: `POST /voice/incoming` (Twilio webhook)
- **Retell WebSocket**: `WS /webhook/retell/llm`
- **Payment Link**: `GET /payment/{token}`

### Environment Variable Priority

1. `API_BASE_URL` (highest priority)
2. `BASE_URL`
3. Railway URL (if `RAILWAY_PUBLIC_DOMAIN` is set)
4. Production domain (`doclittle.site` in production)
5. `localhost:4000` (development default)

---

## ✅ Setup Checklist

### Initial Setup
- [ ] Node.js installed (v18+)
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file created with API keys
- [ ] Server starts locally (`npm start`)

### Production Deployment
- [ ] Railway project created
- [ ] GitHub connected to Railway
- [ ] Environment variables set in Railway
- [ ] Server deployed and running
- [ ] Health check works: `curl https://web-production-a783d.up.railway.app/health`

### Domain Setup
- [ ] Domain registered (doclittle.site)
- [ ] Nameservers updated in IONOS
- [ ] Domain added in Netlify
- [ ] DNS verification complete
- [ ] SSL certificate provisioned
- [ ] Site loads at https://doclittle.site

### Voice Agent Setup
- [ ] Retell agent configured (`node configure-retell.js`)
- [ ] Twilio webhook URL set correctly
- [ ] Test call connects successfully
- [ ] Voice agent responds correctly

### Testing
- [ ] Local server works
- [ ] Production server works
- [ ] Voice calls work
- [ ] Payment links work
- [ ] All endpoints accessible

---

## 🆘 Getting Help

1. **Check Logs:**
   - Railway logs (production)
   - Local terminal (development)
   - Twilio logs (call issues)

2. **Verify Configuration:**
   - Environment variables set correctly
   - Webhook URLs are correct
   - API keys are valid

3. **Common Solutions:**
   - Restart server
   - Check network connectivity
   - Verify API keys
   - Check service status pages

---

**Last Updated**: November 2024  
**Version**: 1.0  
**Status**: Complete Setup Guide



---

<a id="google-google-oauth-complete-guide"></a>

## Google OAuth & Calendar Integration - Complete Guide

*Former path: `docs/setup/google/GOOGLE_OAUTH_COMPLETE_GUIDE.md`*

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

- **API Documentation**: `docs/api/README.md#api-documentation`
- **Deployment Guide**: `docs/deployment/README.md#guides-deployment-guide`
- **Multi-Tenant Architecture**: `docs/architecture/README.md#multi-tenant-multi-tenant-voice-agent`

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



---

<a id="google-oauth-google-calendar-user-experience"></a>

## Google Calendar Integration - User Experience

*Former path: `docs/setup/google/oauth/GOOGLE_CALENDAR_USER_EXPERIENCE.md`*

## Overview

DocLittle provides **seamless, one-click Google Calendar integration**. Users don't need any technical knowledge or setup - they just click "Connect" and we handle everything.

---

## User Journey

### Step 1: User Clicks "Connect" (5 seconds)
- User goes to **Settings** → **Connected Services**
- Sees "Google Calendar: Not connected"
- Clicks **"Connect Google Calendar"** button

### Step 2: Google Authorization (10 seconds)
- User is redirected to Google's OAuth screen
- Sees: "DocLittle wants to access your Google Calendar"
- Clicks **"Allow"** (one click)

### Step 3: Automatic Setup (Instant)
- User is redirected back to DocLittle
- Calendar status shows: **"✅ Connected"**
- **That's it!** No further action needed

---

## What Happens Automatically

Once connected, DocLittle handles **everything** automatically:

### ✅ Availability Checking
- When patients call to schedule, DocLittle checks the user's Google Calendar
- Prevents double-booking
- Respects existing calendar events

### ✅ Event Creation
- New appointments automatically create Google Calendar events
- Events include patient name, appointment type, and time
- Events are added to the user's connected calendar

### ✅ Event Updates
- When appointments are rescheduled, calendar events update automatically
- When appointments are cancelled, calendar events are deleted
- All changes sync in real-time

### ✅ Token Management
- Refresh tokens are stored securely
- Access tokens refresh automatically when expired
- No user action required for token management

### ✅ Error Handling
- If connection is lost, system attempts automatic reconnection
- Users are notified only if manual reconnection is needed
- All errors are handled gracefully

---

## Multi-User Architecture

### How It Works

```
┌─────────────────────────────────────────────┐
│  DocLittle Platform                         │
│  - ONE Google OAuth App (set up once)      │
│  - Handles all OAuth flows                  │
│  - Stores tokens per user securely          │
└─────────────────────────────────────────────┘
              │
              │ Each user connects once
              │
    ┌─────────┴─────────┐
    │                   │
    ▼                   ▼
┌─────────┐        ┌─────────┐
│ User 1  │        │ User 2  │
│ Calendar│        │ Calendar│
│ (Token) │        │ (Token) │
└─────────┘        └─────────┘
```

### Key Points

- **One OAuth App**: DocLittle sets up one Google OAuth application
- **Per-User Tokens**: Each user's tokens are stored separately and securely
- **Isolated Calendars**: Each user's calendar is completely isolated
- **No Conflicts**: Multiple users can connect without interfering with each other

---

## User Experience Examples

### Example 1: First-Time Connection

**Provider A (Dr. Smith)**
1. Logs into DocLittle
2. Goes to Settings
3. Clicks "Connect Google Calendar"
4. Authorizes on Google
5. ✅ Connected in 15 seconds

**Provider B (Dr. Jones)**
1. Logs into DocLittle (same platform)
2. Goes to Settings
3. Clicks "Connect Google Calendar"
4. Authorizes on Google
5. ✅ Connected in 15 seconds

**Result**: Both providers have their own calendars connected, completely isolated from each other.

---

### Example 2: Automatic Syncing

**Scenario**: Patient calls to schedule appointment

1. **Voice Agent**: "I can see you're available at 2 PM tomorrow. Would you like to schedule?"
2. **System**: Automatically checks Dr. Smith's Google Calendar
3. **System**: Sees 2 PM is free (no conflicts)
4. **System**: Creates appointment
5. **System**: Automatically creates Google Calendar event
6. **Result**: Dr. Smith's Google Calendar now shows the appointment

**User Action Required**: None. Everything is automatic.

---

### Example 3: Rescheduling

**Scenario**: Patient calls to reschedule

1. **Voice Agent**: "I can reschedule you to 3 PM instead"
2. **System**: Checks availability at 3 PM
3. **System**: Updates appointment in database
4. **System**: Automatically updates Google Calendar event
5. **Result**: Google Calendar event moves from 2 PM to 3 PM

**User Action Required**: None. Everything is automatic.

---

## Troubleshooting for Users

### "Calendar not syncing"

**Solution**: Click "Refresh" button in Settings. System will:
- Check connection status
- Refresh tokens if needed
- Re-sync calendar events

### "Need to reconnect"

**Solution**: Click "Disconnect" then "Connect" again. System will:
- Clear old tokens
- Start fresh OAuth flow
- Re-establish connection

### "Events not appearing"

**Solution**: Usually resolves automatically. If not:
1. Check that calendar is connected (Settings)
2. Wait 1-2 minutes for sync
3. Click "Refresh" if needed

---

## Security & Privacy

### What We Store
- ✅ Refresh tokens (encrypted)
- ✅ Calendar ID (which calendar to use)
- ✅ Last sync timestamp

### What We DON'T Store
- ❌ Calendar event content (only checks availability)
- ❌ Personal Google account information
- ❌ Passwords or sensitive data

### Token Security
- Tokens are stored per-user, isolated
- Tokens are encrypted at rest
- Tokens refresh automatically
- Users can disconnect anytime

---

## Summary

### For Users
- **One click** to connect
- **Zero maintenance** required
- **Automatic syncing** always
- **Secure** and private

### For Platform (DocLittle)
- **One-time setup** of OAuth app
- **Automatic token management**
- **Per-user isolation**
- **Scalable** to unlimited users

---

## Technical Details (For Developers)

See `docs/setup/README.md#google-google-oauth-complete-guide` for platform setup instructions.



---

<a id="google-oauth-multi-tenant-google-oauth"></a>

## Multi-Tenant Google OAuth Setup

*Former path: `docs/setup/google/oauth/MULTI_TENANT_GOOGLE_OAUTH.md`*

## Your Architecture

```
doclittle.site/clinicA  → Clinic A's dashboard
doclittle.site/clinicB  → Clinic B's dashboard
doclittle.site/clinicC  → Clinic C's dashboard
```

Each clinic is a separate tenant, but they all use the same DocLittle platform.

---

## Google OAuth Setup (One Time)

### Register ONE Redirect URI

In Google Cloud Console, add **ONE redirect URI** that handles all clinics:

```
https://doclittle.site/auth/google/calendar/callback
```

**Do NOT** register separate URIs for each clinic. The system already handles routing back to the correct clinic.

---

## How It Works

### Flow for Clinic A

1. **User at Clinic A** (`doclittle.site/clinicA`) clicks "Connect Google Calendar"
2. **System** redirects to Google OAuth with:
   - Redirect URI: `https://doclittle.site/auth/google/calendar/callback` (same for all)
   - State parameter: Contains `returnUrl: doclittle.site/clinicA/settings`
3. **User** authorizes on Google
4. **Google** redirects back to: `https://doclittle.site/auth/google/calendar/callback`
5. **System** processes OAuth, stores tokens
6. **System** redirects user back to: `doclittle.site/clinicA/settings` (from state)

### Flow for Clinic B

1. **User at Clinic B** (`doclittle.site/clinicB`) clicks "Connect Google Calendar"
2. **System** redirects to Google OAuth with:
   - Redirect URI: `https://doclittle.site/auth/google/calendar/callback` (same)
   - State parameter: Contains `returnUrl: doclittle.site/clinicB/settings`
3. **User** authorizes on Google
4. **Google** redirects back to: `https://doclittle.site/auth/google/calendar/callback`
5. **System** processes OAuth, stores tokens for Clinic B user
6. **System** redirects user back to: `doclittle.site/clinicB/settings` (from state)

---

## Google Cloud Console Configuration

### Authorized Redirect URIs

Add **only these**:

```
http://localhost:4000/auth/google/calendar/callback
https://doclittle.site/auth/google/calendar/callback
```

**That's it!** No need to add:
- ❌ `https://doclittle.site/clinicA/auth/google/calendar/callback`
- ❌ `https://doclittle.site/clinicB/auth/google/calendar/callback`
- ❌ Each clinic separately

---

## Environment Variables

### Development (.env)
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/calendar/callback
```

### Production (.env)
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://doclittle.site/auth/google/calendar/callback
```

---

## How Routing Works

The system already handles this! Here's the code flow:

1. **Connect Request** (`/auth/google/calendar/connect`)
   - Receives `returnUrl` parameter (e.g., `doclittle.site/clinicA/settings`)
   - Encodes it in the OAuth `state` parameter
   - Redirects to Google

2. **Callback** (`/auth/google/calendar/callback`)
   - Google redirects to: `https://doclittle.site/auth/google/calendar/callback`
   - System decodes `state` to get original `returnUrl`
   - Processes OAuth, stores tokens
   - Redirects user back to: `doclittle.site/clinicA/settings`

---

## Multi-Tenant Token Storage

Each clinic's users have separate tokens:

```
Clinic A:
  - user1@clinicA.com → Token A1
  - user2@clinicA.com → Token A2

Clinic B:
  - user1@clinicB.com → Token B1
  - user2@clinicB.com → Token B2
```

Tokens are stored per user, isolated by clinic/user identity.

---

## Summary

✅ **One OAuth App**: DocLittle has one OAuth app
✅ **One Redirect URI**: `https://doclittle.site/auth/google/calendar/callback`
✅ **Multi-Tenant Routing**: System routes back to correct clinic via `returnUrl` in state
✅ **Per-User Tokens**: Each user's tokens stored separately
✅ **Scalable**: Add unlimited clinics without updating Google Cloud Console

---

## Checklist

- [ ] Add `https://doclittle.site/auth/google/calendar/callback` to Google Cloud Console
- [ ] Set `GOOGLE_REDIRECT_URI=https://doclittle.site/auth/google/calendar/callback` in production `.env`
- [ ] Test with Clinic A: Should redirect back to `doclittle.site/clinicA/settings`
- [ ] Test with Clinic B: Should redirect back to `doclittle.site/clinicB/settings`
- [ ] Verify tokens are stored per user/clinic

---

## Important Notes

1. **Don't add clinic-specific redirect URIs** - The single callback handles all clinics
2. **The `returnUrl` in state** handles routing back to the correct clinic
3. **Each clinic's users** get their own tokens, completely isolated
4. **Scalable**: New clinics work automatically without Google Cloud Console changes



---

<a id="readme"></a>

## Setup Documentation

*Former path: `docs/setup/README.md`*

Setup guides and configuration instructions. All paths below are relative to this folder (`docs/setup/`).

---

## 📚 Documentation index (verified paths)

| Topic | File |
|--------|------|
| **Main platform setup** | [`getting-started/SETUP.md`](./README.md#getting-started-setup) |
| **Google OAuth (Calendar, complete)** | [`google/GOOGLE_OAUTH_COMPLETE_GUIDE.md`](./README.md#google-google-oauth-complete-guide) |
| **Multi-tenant Google OAuth** | [`google/oauth/MULTI_TENANT_GOOGLE_OAUTH.md`](./README.md#google-oauth-multi-tenant-google-oauth) |
| **Calendar UX notes** | [`google/oauth/GOOGLE_CALENDAR_USER_EXPERIENCE.md`](./README.md#google-oauth-google-calendar-user-experience) |
| **Stripe Issuing** | [`../integrations/README.md#stripe-issuing-stripe-issuing`](../integrations/README.md#stripe-issuing-stripe-issuing) |
| **Azure email (ACS)** | [`../azure/README.md#readme`](../azure/README.md#readme) |

---

## 🚀 Quick setup

1. Start with [`getting-started/SETUP.md`](./README.md#getting-started-setup).
2. For Google Calendar / OAuth, use [`google/GOOGLE_OAUTH_COMPLETE_GUIDE.md`](./README.md#google-google-oauth-complete-guide).
3. For Stripe Issuing, see [`../integrations/README.md#stripe-issuing-stripe-issuing`](../integrations/README.md#stripe-issuing-stripe-issuing).
4. For Azure Communication Services email, see [`../azure/README.md#readme`](../azure/README.md#readme).

---

## 🔗 Related documentation

- **Azure:** [`../azure/README.md#readme`](../azure/README.md#readme)
- **Deployment:** [`../deployment/README.md#readme`](../deployment/README.md#readme)
- **Main docs hub:** [`../README.md#readme`](../README.md#readme)

---

**Last Updated:** April 9, 2026



