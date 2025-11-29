# IONOS DNS Configuration for doclittle.site

## 🎯 What You Need to Configure

You need to add **ONE DNS record** in IONOS to point `doclittle.site` to your Azure App Service.

---

## 📋 Step-by-Step IONOS Configuration

### Step 1: Get Azure App Service IP Address

**Option A: Azure Portal**
1. Go to https://portal.azure.com
2. Navigate to: **Resource Groups** → **doclittle** → **doclittle** (App Service)
3. Click **Properties** in the left menu
4. Copy the **Outbound IP addresses** (use the first IP address)

**Option B: Azure CLI**
```bash
az webapp show \
  --name doclittle \
  --resource-group doclittle \
  --query "outboundIpAddresses" \
  --output tsv
```

**Note:** Azure App Services can have multiple outbound IPs. Use the **first one** listed.

---

### Step 2: Log in to IONOS

1. Go to: https://www.ionos.com
2. Click **Login** (top right)
3. Enter your credentials

---

### Step 3: Navigate to DNS Settings

1. After logging in, go to: **Domains** (in the main menu)
2. Find **doclittle.site** in your domain list
3. Click on **doclittle.site**
4. Click **DNS Settings** (or **DNS** tab)

**Direct Link:**
https://my.ionos.com/domain-dns-settings/doclittle.site

---

### Step 4: Add A Record for Root Domain

1. Click the **"Add record"** button (blue button, usually top left)
2. Fill in the form:

   **A Record Configuration:**
   - **Type:** Select **A** from dropdown
   - **Name/Host:** Enter `@` (or leave blank - this means root domain)
   - **Value/IP Address:** Paste the Azure IP address you got from Step 1
   - **TTL:** `3600` (or leave default)
   
3. Click **Save** (or **Add**)

**Visual Guide:**
```
Type:     [A ▼]
Name:     [@]
Value:    [20.XX.XX.XX]  ← Your Azure IP
TTL:      [3600]
```

---

### Step 5: Verify Existing Records

**You should already have these records (DO NOT DELETE):**

✅ **CNAME Records:**
- `api` → `doclittle.azurewebsites.net` (for api.doclittle.site)
- `_domainconnect` → `_domainconnect.ionos.com`
- `autodiscover` → `adsredir.ionos.info`
- Various `_domainkey` records (for email)

✅ **MX Records:**
- `@` → `mx00.ionos.com`
- `@` → `mx01.ionos.com`

✅ **TXT Records:**
- `@` → `"v=spf1 include:spf.protection.outlook.com -all"`
- `@` → `"ms-domain-verification=..."`
- `asuid.api` → `"e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2"`

**⚠️ IMPORTANT:** Only add the A record for root domain. Do NOT modify or delete existing records!

---

## 🔍 Alternative: If IONOS Doesn't Support A Record on Root

Some DNS providers don't allow A records on root domain (`@`). If IONOS shows an error:

### Option 1: Use ALIAS Record (if available)
- **Type:** ALIAS (or CNAME for root)
- **Name:** `@`
- **Value:** `doclittle.azurewebsites.net`
- **TTL:** 3600

### Option 2: Contact IONOS Support
Ask them to enable root domain CNAME/ALIAS support, or use their domain forwarding feature.

---

## ✅ Verification Steps

### 1. Check DNS Propagation

**Wait 5-30 minutes after adding the record**, then verify:

```bash
# Check DNS resolution
dig doclittle.site

# Or use online tool:
# https://dnschecker.org/#A/doclittle.site
```

**Expected Result:**
```
doclittle.site.    IN    A    20.XX.XX.XX  ← Your Azure IP
```

### 2. Test Domain in Browser

After DNS propagates:
- Visit: `http://doclittle.site` (should load, even without SSL)
- Visit: `https://doclittle.site` (will show SSL warning until certificate is created)

---

## 📊 Complete DNS Record Summary

After configuration, you should have:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| **A** | `@` | `20.XX.XX.XX` | **Root domain → Azure** ⭐ NEW |
| CNAME | `api` | `doclittle.azurewebsites.net` | API subdomain |
| CNAME | `_domainconnect` | `_domainconnect.ionos.com` | Domain Connect |
| CNAME | `autodiscover` | `adsredir.ionos.info` | Email autodiscover |
| MX | `@` | `mx00.ionos.com` | Email server |
| MX | `@` | `mx01.ionos.com` | Email server |
| TXT | `@` | `"v=spf1..."` | SPF record |
| TXT | `asuid.api` | `"e81a8b6649a65b93..."` | Azure verification |

---

## 🚨 Common Issues

### Issue: "Cannot add A record on root domain"
**Solution:** Use ALIAS/CNAME if available, or contact IONOS support.

### Issue: DNS not resolving after 30 minutes
**Solution:**
1. Double-check the IP address is correct
2. Verify record was saved in IONOS
3. Clear DNS cache: `sudo dscacheutil -flushcache` (Mac) or restart browser
4. Check with different DNS server: `dig @8.8.8.8 doclittle.site`

### Issue: Wrong IP address
**Solution:**
- Get the correct IP from Azure Portal → App Service → Properties → Outbound IP addresses
- Update the A record in IONOS

---

## 📝 Quick Reference

**IONOS DNS Settings URL:**
https://my.ionos.com/domain-dns-settings/doclittle.site

**What to Add:**
- **Type:** A
- **Name:** `@`
- **Value:** Azure App Service IP (from Azure Portal)
- **TTL:** 3600

**What NOT to Change:**
- ❌ Don't delete existing CNAME records
- ❌ Don't delete MX records
- ❌ Don't delete TXT records
- ❌ Don't modify the `api` CNAME record

---

## ✅ After DNS is Configured

Once DNS propagates (5-30 minutes):

1. **Add domain in Azure:**
   ```bash
   az webapp config hostname add \
     --resource-group doclittle \
     --webapp-name doclittle \
     --hostname doclittle.site
   ```

2. **Create SSL certificate:**
   ```bash
   az webapp config ssl create \
     --resource-group doclittle \
     --name doclittle \
     --hostname doclittle.site
   ```

3. **Bind SSL certificate:**
   ```bash
   # Get thumbprint first
   az webapp config ssl show \
     --resource-group doclittle \
     --certificate-name doclittle.site \
     --query thumbprint --output tsv
   
   # Then bind (replace <THUMBPRINT>)
   az webapp config ssl bind \
     --resource-group doclittle \
     --name doclittle \
     --certificate-thumbprint <THUMBPRINT> \
     --ssl-type SNI \
     --hostname doclittle.site
   ```

---

**Status:** 📋 Ready to Configure  
**Last Updated:** January 2025

