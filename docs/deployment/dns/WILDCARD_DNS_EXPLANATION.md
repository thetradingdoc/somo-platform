# Wildcard DNS vs Azure Custom Domains

## 🔍 Understanding the Difference

### DNS Routing (Wildcard CNAME) ✅

If you have a wildcard CNAME:
```
* → doclittle.azurewebsites.net
```

**What this does:**
- ✅ Routes ALL subdomains to Azure App Service
- ✅ DNS resolution works: `doctor-little.doclittle.site` → `doclittle.azurewebsites.net`
- ✅ Your server code can handle any subdomain (it extracts subdomain from hostname)

**What this DOESN'T do:**
- ❌ Doesn't add the subdomain as a "custom domain" in Azure
- ❌ Doesn't create SSL certificates automatically
- ❌ Azure App Service doesn't recognize it as a valid custom domain

---

## ⚠️ The Problem

Even with wildcard DNS, Azure App Service requires:

1. **Each subdomain must be added as a custom domain** in Azure Portal
2. **Each subdomain needs its own SSL certificate** (or wildcard cert)

**Why?**
- Azure App Service validates custom domains before serving HTTPS
- SSL certificates are domain-specific (not automatically inherited from wildcard DNS)

---

## ✅ What You Need to Do

### Step 1: Verify Wildcard DNS Works

```bash
# Test DNS resolution
dig doctor-little.doclittle.site CNAME
# Should show: doclittle.azurewebsites.net

# Test HTTP (should work)
curl -I http://doctor-little.doclittle.site
# Should return 200 OK (HTTP works)
```

### Step 2: Add Custom Domain in Azure

Even with wildcard DNS, you must add each subdomain:

```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doctor-little.doclittle.site
```

**Why?** Azure needs to:
- Verify domain ownership
- Configure routing
- Enable HTTPS binding

### Step 3: Create SSL Certificate

```bash
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doctor-little.doclittle.site
```

### Step 4: Bind SSL Certificate

```bash
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doctor-little.doclittle.site \
  --query thumbprint --output tsv)

az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint $THUMBPRINT \
  --ssl-type SNI \
  --hostname doctor-little.doclittle.site
```

---

## 🎯 Summary

| Component | Wildcard DNS | Azure Custom Domain | SSL Certificate |
|-----------|--------------|---------------------|-----------------|
| **Purpose** | Routes traffic | Validates & enables HTTPS | Encrypts connection |
| **Works for all subdomains?** | ✅ Yes | ❌ No (per subdomain) | ❌ No (per subdomain) |
| **Required?** | ✅ Yes | ✅ Yes | ✅ Yes |

**Even with wildcard DNS, you still need to:**
1. Add each subdomain as custom domain in Azure
2. Create SSL certificate for each subdomain
3. Bind SSL certificate to each subdomain

---

## 💡 Better Solution: Cloudflare

Instead of managing individual certificates, use Cloudflare:

1. **Wildcard DNS** → Routes all subdomains
2. **Cloudflare SSL** → Automatic certificates for ALL subdomains
3. **Azure Custom Domains** → Still need to add, but SSL is handled by Cloudflare

See [SUBDOMAIN_SSL_FIX.md](./SUBDOMAIN_SSL_FIX.md) for Cloudflare setup.

---

## 🔍 How to Check Current Setup

### Check DNS:
```bash
dig doctor-little.doclittle.site CNAME
dig akin-dunbar.doclittle.site CNAME
```

### Check Azure Custom Domains:
```bash
az webapp config hostname list \
  --resource-group doclittle \
  --webapp-name doclittle \
  --output table
```

### Check SSL Certificates:
```bash
az webapp config ssl list \
  --resource-group doclittle \
  --output table
```

---

**Last Updated**: December 2024


