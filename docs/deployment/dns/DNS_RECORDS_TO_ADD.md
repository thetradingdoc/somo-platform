# DNS Records to Add for Tenant Subdomains

## Current DNS Status

From your IONOS DNS settings, you have:
- ✅ `api` CNAME → `doclittle.azurewebsites.net` (working)
- ✅ Wildcard `*` CNAME → Azure email domain key (for email/DKIM)
- ✅ A records for `@` and `www` → `20.115.232.16`

## Missing Records

You need to add CNAME records for each tenant subdomain:

---

## 📋 Records to Add

### 1. For `akin-dunbar` (if not already working)

**CNAME Record:**
```
Type: CNAME
Host Name: akin-dunbar
Value: doclittle.azurewebsites.net
TTL: 3600 (or default)
```

**Why**: This routes `akin-dunbar.doclittle.site` to your Azure App Service.

---

### 2. For `doctor-little` (new tenant)

**CNAME Record:**
```
Type: CNAME
Host Name: doctor-little
Value: doclittle.azurewebsites.net
TTL: 3600 (or default)
```

**Why**: This routes `doctor-little.doclittle.site` to your Azure App Service.

---

## 🎯 How to Add in IONOS

1. Go to: https://my.ionos.com/domain-dns-settings/doclittle.site
2. Click **"Add record"** button (top right)
3. Fill in:
   - **Type**: Select `CNAME`
   - **Host Name**: Enter `doctor-little` (or `akin-dunbar`)
   - **Value**: Enter `doclittle.azurewebsites.net`
   - **TTL**: Leave default or set to `3600`
4. Click **Save**
5. Wait 5-30 minutes for DNS propagation

---

## ✅ Verification

After adding the CNAME record, verify it:

```bash
# Check DNS propagation
dig doctor-little.doclittle.site CNAME

# Should show:
# doctor-little.doclittle.site. 3600 IN CNAME doclittle.azurewebsites.net.
```

---

## 🔍 Why `akin-dunbar` Might Be Working

If `akin-dunbar.doclittle.site` is working but you don't see a CNAME record, it might be:

1. **Using the A record** - But this would only work for root domain, not subdomains
2. **Configured directly in Azure** - Azure might be handling it differently
3. **Actually not working with HTTPS** - Might be HTTP only or have SSL errors

**Check if `akin-dunbar` actually works:**
```bash
curl -I https://akin-dunbar.doclittle.site
# If you get SSL errors, it needs the CNAME + SSL certificate
```

---

## 📊 Complete DNS Setup for Multi-Tenant

For a proper multi-tenant setup, you'll need:

| Host Name | Type | Value | Purpose |
|-----------|------|-------|---------|
| `@` | A | `20.115.232.16` | Root domain |
| `www` | A | `20.115.232.16` | WWW subdomain |
| `api` | CNAME | `doclittle.azurewebsites.net` | API subdomain ✅ |
| `akin-dunbar` | CNAME | `doclittle.azurewebsites.net` | Tenant 1 ⚠️ |
| `doctor-little` | CNAME | `doclittle.azurewebsites.net` | Tenant 2 ⚠️ |
| `*` | CNAME | `(Azure email key)` | Email/DKIM ✅ |

**Note**: The wildcard `*` CNAME is for email, not subdomain routing. Each tenant needs its own CNAME record.

---

## 🚀 Next Steps After Adding DNS

1. **Add custom domain in Azure** (if not already done):
   ```bash
   az webapp config hostname add \
     --resource-group doclittle \
     --webapp-name doclittle \
     --hostname doctor-little.doclittle.site
   ```

2. **Wait for DNS propagation** (5-30 minutes)

3. **Create SSL certificate**:
   ```bash
   az webapp config ssl create \
     --resource-group doclittle \
     --name doclittle \
     --hostname doctor-little.doclittle.site
   ```

4. **Bind SSL certificate** (see [TENANT_SUBDOMAIN_SETUP.md](./TENANT_SUBDOMAIN_SETUP.md))

---

**Last Updated**: December 2024


