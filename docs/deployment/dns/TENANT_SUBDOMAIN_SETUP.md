# Tenant Subdomain Setup Guide

**How to add a new tenant subdomain (e.g., `doctor-little.doclittle.site`)**

This guide shows how `akin-dunbar.doclittle.site` was set up, and how to replicate it for new tenants.

---

## 📋 Overview

For each tenant subdomain, you need to:
1. **Add CNAME in DNS** (IONOS)
2. **Add custom domain in Azure**
3. **Create SSL certificate**
4. **Bind SSL certificate**

---

## 🚀 Quick Setup (Automated)

Use the provided script:

```bash
cd /path/to/doclittle-platform
./scripts/add-tenant-subdomain.sh doctor-little
```

This will:
- ✅ Add the domain to Azure App Service
- ✅ Provide DNS configuration instructions
- ✅ Show SSL certificate setup commands

---

## 📝 Manual Setup Steps

### Step 1: Add CNAME Record in IONOS

1. Go to: https://my.ionos.com/domain-dns-settings/doclittle.site
2. Click **"Add record"**
3. Add **CNAME Record**:
   ```
   Type: CNAME
   Name/Host: doctor-little
   Value/Points to: doclittle.azurewebsites.net
   TTL: 3600
   ```
4. Click **Save**
5. Wait 5-30 minutes for DNS propagation

**Verify DNS:**
```bash
dig doctor-little.doclittle.site CNAME
# Should show: doclittle.azurewebsites.net
```

---

### Step 2: Add Custom Domain in Azure

**Option A: Azure Portal**
1. Go to: https://portal.azure.com
2. Navigate to: Resource Groups → `doclittle` → App Service `doclittle`
3. Click **Custom domains** (left menu)
4. Click **+ Add custom domain**
5. Enter: `doctor-little.doclittle.site`
6. Azure will verify DNS automatically

**Option B: Azure CLI**
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doctor-little.doclittle.site
```

**Verify:**
```bash
az webapp config hostname list \
  --resource-group doclittle \
  --webapp-name doclittle \
  --query "[?name=='doctor-little.doclittle.site']" \
  --output table
```

---

### Step 3: Create SSL Certificate

**Wait for DNS to propagate first** (5-30 minutes), then:

```bash
# Create managed certificate (free)
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doctor-little.doclittle.site
```

**Note**: This may take a few minutes. Azure will automatically verify domain ownership.

---

### Step 4: Get Certificate Thumbprint

```bash
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doctor-little.doclittle.site \
  --query thumbprint \
  --output tsv
```

Copy the thumbprint (e.g., `A1B2C3D4E5F6...`)

---

### Step 5: Bind SSL Certificate

```bash
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --hostname doctor-little.doclittle.site
```

Replace `<THUMBPRINT>` with the value from Step 4.

---

## ✅ Verification

### Test DNS
```bash
dig doctor-little.doclittle.site CNAME
# Should show: doclittle.azurewebsites.net
```

### Test HTTPS
```bash
curl -I https://doctor-little.doclittle.site
# Should return 200 OK with valid SSL
```

### Test in Browser
Visit: `https://doctor-little.doclittle.site`
- Should show green padlock
- No certificate errors
- Should load the tenant dashboard

---

## 🔍 How `akin-dunbar` Was Set Up

Based on the codebase, `akin-dunbar.doclittle.site` was configured using the same process:

1. **DNS**: CNAME record `akin-dunbar` → `doclittle.azurewebsites.net`
2. **Azure**: Custom domain added via Azure Portal or CLI
3. **SSL**: Managed certificate created and bound
4. **Database**: Merchant record with `subdomain = 'akin-dunbar'`

The same process applies to any new tenant subdomain.

---

## ⚠️ Important Notes

### SSL Certificate Limitation

**Azure managed certificates are single-domain only**. This means:
- ✅ `doclittle.site` has its own certificate
- ✅ `api.doclittle.site` has its own certificate
- ✅ `akin-dunbar.doclittle.site` has its own certificate
- ✅ `doctor-little.doclittle.site` needs its own certificate

**For multiple tenant subdomains, consider:**
- **Cloudflare** (recommended) - automatic SSL for all subdomains
- **Wildcard certificate** - manual setup, more complex
- **Individual certificates** - works but requires manual setup per tenant

See [SUBDOMAIN_SSL_FIX.md](./SUBDOMAIN_SSL_FIX.md) for details.

---

## 🎯 Complete Example: Setting Up `doctor-little`

```bash
# 1. Add to Azure
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doctor-little.doclittle.site

# 2. Wait for DNS propagation (add CNAME in IONOS first)
# CNAME: doctor-little → doclittle.azurewebsites.net

# 3. Create SSL certificate (after DNS propagates)
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doctor-little.doclittle.site

# 4. Get thumbprint
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doctor-little.doclittle.site \
  --query thumbprint \
  --output tsv)

# 5. Bind certificate
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint $THUMBPRINT \
  --ssl-type SNI \
  --hostname doctor-little.doclittle.site

# 6. Verify
curl -I https://doctor-little.doclittle.site
```

---

## 📊 Current Subdomains

Based on codebase analysis:

| Subdomain | Type | Status |
|-----------|------|--------|
| `api.doclittle.site` | API | ✅ Configured |
| `akin-dunbar.doclittle.site` | Tenant | ✅ Configured |
| `doctor-little.doclittle.site` | Tenant | ⚠️ Needs setup |

---

## 🔗 Related Documentation

- [Subdomain SSL Fix](./SUBDOMAIN_SSL_FIX.md) - SSL certificate solutions
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - General deployment
- [DNS Configuration](./dns/ionos/IONOS_DNS_CONFIGURATION.md) - DNS setup

---

## 🛠️ Troubleshooting

### Domain Not Verifying in Azure

**Problem**: Azure shows "Not verified" for the custom domain

**Solutions**:
1. Check DNS propagation: `dig doctor-little.doclittle.site CNAME`
2. Ensure CNAME points to `doclittle.azurewebsites.net` (exact match)
3. Wait longer (can take up to 30 minutes)
4. Check for typos in DNS record

### SSL Certificate Not Creating

**Problem**: `az webapp config ssl create` fails

**Solutions**:
1. Ensure DNS is fully propagated
2. Verify domain is added to Azure first
3. Check Azure Portal → Custom domains for error messages
4. Try again after 10-15 minutes

### Certificate Error in Browser

**Problem**: `NET::ERR_CERT_COMMON_NAME_INVALID`

**Solutions**:
1. Verify certificate is bound: `az webapp config ssl list`
2. Check certificate name matches domain exactly
3. Clear browser cache
4. Try incognito/private mode

---

**Last Updated**: December 2024  
**Status**: Ready for Use




