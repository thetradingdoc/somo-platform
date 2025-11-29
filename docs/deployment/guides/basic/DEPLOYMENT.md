# Deployment Guide - api.doclittle.site

**Single master deployment document - updated as we progress.**

---

## 🎯 CURRENT STATUS

- [x] Azure account: gigtogigdev@gmail.com
- [x] Domain: doclittle.site (IONOS)
- [x] App Service created: `doclittle`
- [x] Resource Group: `doclittle`
- [x] Location: `westus2` (eastus has no quota)
- [x] Runtime: Node 20 LTS (Linux)
- [x] Application Insights: Configured
- [x] Environment variables configured
- [x] DNS configured (api.doclittle.site)
- [x] Custom domain added in Azure (`api.doclittle.site` - Verified)
- [x] SSL certificate created (expires: 2026-04-14)
- [x] SSL certificate bound to domain
- [x] Code deployed

---

## 📋 QUICK REFERENCE

### Azure Resources
- **Resource Group:** `doclittle`
- **App Service:** `doclittle`
- **App Service Plan:** `ASP-doclittle-8050` (Basic SKU)
- **Default URL:** `doclittle.azurewebsites.net`
- **Custom Domain:** `api.doclittle.site` (to be configured)
- **Location:** `westus2` (eastus has no quota - will move to eastus when quota is available)
- **Runtime:** Node 20 LTS (Linux)

### Quick Commands
```bash
# Login to Azure
az login

# Deploy code
./scripts/deploy-to-azure.sh

# Configure environment variables
./scripts/configure-azure-env.sh

# View logs
az webapp log tail --name doclittle --resource-group doclittle

# List environment variables
az webapp config appsettings list --name doclittle --resource-group doclittle
```

---

## 🚀 DEPLOYMENT STEPS

### ✅ Step 1: App Service Created (DONE)
- App Service: `doclittle`
- Resource Group: `doclittle`
- Location: `westus2` (eastus has no quota)
- Runtime: Node 20 LTS

### Step 2: Configure Environment Variables

**Option A: Azure Portal (Recommended)**
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **Resource Groups** → **doclittle** → **doclittle**
3. Click **Configuration** → **Application settings**
4. Add all variables from your local `.env` file (see list below)

**Option B: Script**
```bash
chmod +x scripts/configure-azure-env.sh
./scripts/configure-azure-env.sh
```

**Required Variables:**
- `NODE_ENV=production`
- `PORT=4000`
- `API_BASE_URL=https://api.doclittle.site`
- `STRIPE_SECRET_KEY` (from your .env)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `RETELL_API_KEY`, `RETELL_AGENT_ID`
- `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_EMAIL_SENDER`

**Complete Environment Variables List:**
- `NODE_ENV=production`
- `PORT=4000`
- `API_BASE_URL=https://api.doclittle.site`
- `STRIPE_SECRET_KEY` (from Stripe Dashboard)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (from Twilio Console)
- `RETELL_API_KEY`, `RETELL_AGENT_ID` (from Retell Dashboard)
- `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_EMAIL_SENDER` (from Azure Portal)
- Optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (if using Calendar)
- Optional: `CIRCLE_API_KEY`, `CIRCLE_WALLET_SET_ID` (if using Circle)

### Step 3: Configure DNS in IONOS (NEXT)

1. Log in to [IONOS](https://www.ionos.com)
2. Go to **Domains** → **doclittle.site** → **DNS Settings**
3. Add **TXT record** for domain verification:
   - **Type:** TXT
   - **Name/Host:** `asuid.api`
   - **Value:** `e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2`
   - **TTL:** 3600 (or default)
4. Add **CNAME record**:
   - **Type:** CNAME
   - **Name/Host:** `api`
   - **Value/Points to:** `doclittle.azurewebsites.net`
   - **TTL:** 3600 (or default)
5. Click **Save** for both records
6. Wait for DNS propagation (5-30 minutes)

**Verify DNS propagation:**
```bash
dig api.doclittle.site
# Should show: doclittle.azurewebsites.net
```

### Step 4: Add Custom Domain in Azure

1. Go to Azure Portal → **doclittle** App Service
2. Click **Custom domains** in left menu
3. Click **+ Add custom domain**
4. Enter: `api.doclittle.site`
5. Azure will verify DNS automatically
6. Once verified, SSL certificate will be provisioned automatically

### Step 5: Deploy Code

**Option A: ZIP Deployment (Quick)**
```bash
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**Option B: Manual ZIP**
```bash
cd middleware-platform
zip -r ../deploy.zip . -x "*.git*" -x "*node_modules/.cache*" -x "*.env*"

az webapp deployment source config-zip \
    --resource-group doclittle \
    --name doclittle \
    --src ../deploy.zip
```

**Option C: GitHub Actions (Future)**
- Set up GitHub Actions workflow for CI/CD

### Step 6: Verify Deployment

```bash
# Check app status
az webapp show --name doclittle --resource-group doclittle --query state

# View logs
az webapp log tail --name doclittle --resource-group doclittle

# Test endpoint
curl https://doclittle.azurewebsites.net/health
```

### Step 7: Update Webhooks

**Retell.ai:**
1. Go to [Retell Dashboard](https://dashboard.retellai.com)
2. Navigate to your agent
3. Update **LLM WebSocket URL** to:
   `wss://api.doclittle.site/webhook/retell/llm`

**Twilio:**
1. Go to [Twilio Console](https://console.twilio.com)
2. Navigate to **Phone Numbers** → Your number
3. Update **Voice & Fax** webhook to:
   `https://api.doclittle.site/voice/incoming`

### Step 8: Create & Bind Managed SSL (Required)

```bash
# Create the free managed certificate (takes ~1 minute)
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname api.doclittle.site

# Check the certificate thumbprint
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name api.doclittle.site \
  --query thumbprint

# Bind certificate to the custom domain
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint 188120E01FD432DF86E0D16AC2E5EF6B14B1FF0F \
  --ssl-type SNI
```

> **Tip:** All commands above are scripted in `scripts/setup-custom-domain.sh`.

### Step 9: Production Voice Agent Checklist

1. **Twilio**
   - Voice webhook: `https://api.doclittle.site/voice/incoming`
   - SMS webhook (optional): `https://api.doclittle.site/voice/sms`
2. **Retell**
   - LLM WebSocket: `wss://api.doclittle.site/webhook/retell/llm`
   - Function endpoints: `https://api.doclittle.site/voice/...`
   - Dynamic variables must include `clinic_id`
3. **Admin Portal**
   - URL: `https://api.doclittle.site/admin/portal`
   - Shows live calls, costs, errors, per-client analytics

---

## 🔍 TROUBLESHOOTING

### App Not Starting
```bash
# Check logs
az webapp log tail --name doclittle --resource-group doclittle

# Check environment variables
az webapp config appsettings list --name doclittle --resource-group doclittle
```

### DNS Not Working
- Wait 30 minutes for propagation
- Verify CNAME in IONOS matches Azure URL exactly
- Check DNS propagation: `dig api.doclittle.site`

### Custom Domain Not Verifying
- Ensure CNAME is correct in IONOS
- Wait for DNS propagation
- Check Azure Portal → Custom domains for error messages

### SSL Still Says "Not Secure"
- Confirm the managed certificate exists:
  ```bash
  az webapp config ssl show \
    --resource-group doclittle \
    --certificate-name api.doclittle.site
  ```
- Ensure `hostNameSslStates` lists `api.doclittle.site` with `SniEnabled`.
- Wait 1-2 minutes after binding, then hard refresh (Cmd+Shift+R).

---

---

## 📝 QUICK REFERENCE: Environment Variables

**Set in Azure Portal → Configuration → Application settings:**

**Required:**
- `NODE_ENV=production`
- `PORT=4000`
- `API_BASE_URL=https://api.doclittle.site`
- `STRIPE_SECRET_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `RETELL_API_KEY`, `RETELL_AGENT_ID`
- `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_EMAIL_SENDER`

**Optional:**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Calendar integration)
- `CIRCLE_API_KEY`, `CIRCLE_WALLET_SET_ID` (Circle payments)
- `MERCHANT_ID` (defaults if not set)

---

## 📊 Admin Portal & Monitoring

| Endpoint | Purpose |
|----------|---------|
| `/api/admin/stats` | Live calls, revenue, error rate |
| `/api/admin/costs` | Twilio & Retell spend per clinic |
| `/api/admin/logs?clinic_id=xxx` | Error logs per voice agent |
| `/api/admin/clients/:clinicId/analytics` | Deep dive per client (calls, costs, revenue) |

**UI:** `https://api.doclittle.site/admin/portal`  
Includes dashboard, client management, cost analytics, and debug logs.

## ✅ Testing Checklist

```bash
curl https://api.doclittle.site/
curl https://api.doclittle.site/health
open https://api.doclittle.site/docs
open https://api.doclittle.site/admin/portal
```

| Test | Expected Result |
|------|-----------------|
| `/` | JSON metadata & endpoint map |
| `/health` | `{"status":"ok"}` |
| `/docs` | Web-based API documentation |
| `/admin/portal` | Admin dashboard loads |
| Twilio call | Connects to Retell agent (check logs) |

## 🔁 Helpful Scripts

| Script | Description |
|--------|-------------|
| `scripts/setup-custom-domain.sh` | Guides DNS + SSL setup |
| `scripts/add-custom-domain.sh` | Adds hostname to Azure |
| `scripts/verify-dns.sh` | Confirms TXT + CNAME records |
| `scripts/compare-config.js` | Local vs production env diff |
| `scripts/update-production-config.js` | Pushes new Twilio/Retell values |
| `scripts/test-config.js` | Verifies Twilio, Retell, and health endpoints |

---

**Last Updated:** 2025-11-17  
**Status:** Production deployment LIVE (domain + SSL + admin portal operational)

