# Quick Deployment Guide - Azure App Service

**Last Updated**: December 2024  
**Status**: Production Ready

> **Note**: This is a quick reference. For complete deployment guide, see [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md)

## 🚀 Deploy doclittle.site to Azure (Demo Ready)

### Prerequisites
- Azure CLI installed
- Logged in to Azure: `az login`
- Domain `doclittle.site` managed in IONOS

---

## Step 1: Deploy Code (Includes Frontend + Backend)

```bash
cd /path/to/doclittle-platform
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**What this does:**
- ✅ Packages `middleware-platform` (backend + API)
- ✅ Includes `unified-dashboard` (frontend)
- ✅ Deploys to Azure App Service `doclittle`
- ✅ Excludes node_modules (Azure installs them)

---

## Step 2: Add Root Domain to Azure

```bash
chmod +x scripts/add-root-domain.sh
./scripts/add-root-domain.sh
```

**Or manually:**
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site
```

---

## Step 3: Configure DNS in IONOS

1. Go to: https://my.ionos.com/domain-dns-settings/doclittle.site
2. Click **"Add record"**
3. Add **A Record** (or **ALIAS** if supported):

   **For A Record:**
   - **Type:** A
   - **Name/Host:** `@` (or leave blank)
   - **Value/IP:** Get from Azure Portal → App Service `doclittle` → Properties → Outbound IP addresses (use first IP)
   - **TTL:** 3600 (or default)

   **OR for ALIAS (if supported):**
   - **Type:** ALIAS
   - **Name/Host:** `@`
   - **Value:** `doclittle.azurewebsites.net`
   - **TTL:** 3600

4. Click **Save**
5. Wait 5-30 minutes for DNS propagation

**Verify DNS:**
```bash
dig doclittle.site
# Should show Azure App Service IP or azurewebsites.net
```

---

## Step 4: Create SSL Certificate

**After DNS propagates (check with `dig doclittle.site`):**

```bash
# Create managed certificate (free)
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site

# Get certificate thumbprint
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doclittle.site \
  --query thumbprint \
  --output tsv

# Bind certificate (replace <THUMBPRINT> with output above)
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --hostname doclittle.site
```

---

## Step 5: Verify Deployment

### Test URLs:

```bash
# Root domain - should show landing page
curl https://doclittle.site

# API subdomain - should show signup page
curl https://api.doclittle.site

# Health check
curl https://api.doclittle.site/health

# Admin portal (should be accessible on root domain)
open https://doclittle.site/admin
```

### Expected Results:

| URL | Should Show |
|-----|-------------|
| `https://doclittle.site` | Landing page (unified-dashboard) |
| `https://doclittle.site/login` | Login page |
| `https://doclittle.site/admin` | Admin portal |
| `https://doclittle.site/business/*` | Business dashboard |
| `https://api.doclittle.site` | Signup page |
| `https://api.doclittle.site/docs` | API docs (protected) |
| `https://api.doclittle.site/health` | `{"status":"ok"}` |

---

## 🔍 Troubleshooting

### DNS Not Resolving

```bash
# Check DNS propagation
dig doclittle.site
nslookup doclittle.site

# If not resolving, wait 30 minutes and try again
```

### SSL Certificate Not Working

```bash
# Check certificate status
az webapp config ssl list \
  --resource-group doclittle \
  --name doclittle

# Verify DNS first before creating certificate
dig doclittle.site
```

### Frontend Not Loading

1. **Check logs:**
   ```bash
   az webapp log tail --name doclittle --resource-group doclittle
   ```

2. **Verify routes in server.js:**
   - Root domain should serve canonical `/` (LittleLab landing build when present)
   - Legacy `/landing` and `/landing.html` should redirect to `/`
   - API subdomain should serve `public/signup/index.html`

3. **Check static files:**
   - Verify `unified-dashboard` is included in deployment
   - Check Azure Portal → Deployment Center → Logs

### 404 Errors

- Verify domain is added: `az webapp config hostname list --resource-group doclittle --webapp-name doclittle`
- Check SSL certificate is bound
- Verify DNS is pointing to correct IP

---

## 📊 Quick Status Check

```bash
# Check App Service status
az webapp show --name doclittle --resource-group doclittle --query state

# List all custom domains
az webapp config hostname list \
  --resource-group doclittle \
  --webapp-name doclittle \
  --output table

# View recent logs
az webapp log tail --name doclittle --resource-group doclittle
```

---

## 🎯 Demo Checklist

Before showing to clients:

- [ ] `https://doclittle.site` loads landing page
- [ ] `https://doclittle.site/login` works
- [ ] `https://doclittle.site/admin` accessible
- [ ] `https://api.doclittle.site` shows signup page
- [ ] `https://api.doclittle.site/health` returns `{"status":"ok"}`
- [ ] SSL certificates valid (no browser warnings)
- [ ] All static assets load (CSS, JS, images)
- [ ] Frontend connects to `https://api.doclittle.site` API

---

## 🔄 Updating Deployment

To update code after changes:

```bash
# Make your changes locally
# Then redeploy:
./scripts/deploy-to-azure.sh
```

Azure will:
1. Upload new code
2. Install dependencies
3. Restart the app
4. Apply changes (usually takes 2-5 minutes)

---

## 📞 Support

**Azure Portal:** https://portal.azure.com
- Navigate to: Resource Groups → doclittle → doclittle

**IONOS DNS:** https://my.ionos.com/domain-dns-settings/doclittle.site

**View Logs:**
```bash
az webapp log tail --name doclittle --resource-group doclittle
```

---

**Status:** ✅ Ready for Deployment  
**Last Updated:** January 2025

