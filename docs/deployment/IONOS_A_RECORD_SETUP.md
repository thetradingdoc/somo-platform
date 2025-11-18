# IONOS A Record Setup - Quick Reference

## ✅ Your Azure IP Address

**Use this IP in IONOS:**
```
20.99.227.36
```

---

## 📋 IONOS Configuration

### Step 1: Go to IONOS DNS Settings
**Direct Link:** https://my.ionos.com/domain-dns-settings/doclittle.site

### Step 2: Add A Record
Click **"Add record"** button and fill in:

| Field | Value |
|-------|-------|
| **Type** | `A` |
| **Name/Host** | `@` (or leave blank) |
| **Value/IP** | `20.99.227.36` |
| **TTL** | `3600` (or default) |

### Step 3: Save
Click **Save** or **Add**

---

## ⚠️ Important Notes

**DO NOT DELETE existing records:**
- ✅ Keep `api` CNAME → `doclittle.azurewebsites.net`
- ✅ Keep all MX records (for email)
- ✅ Keep all TXT records
- ✅ Keep all `_domainkey` records

**Only add the new A record for root domain.**

---

## ✅ After Adding DNS Record

### 1. Wait for DNS Propagation (5-30 minutes)

### 2. Verify DNS Resolution
```bash
dig doclittle.site
# Should show: 20.99.227.36
```

### 3. Add Domain in Azure
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site
```

### 4. Create SSL Certificate (after DNS propagates)
```bash
# Create certificate
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site

# Get thumbprint
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doclittle.site \
  --query thumbprint \
  --output tsv)

# Bind certificate
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint $THUMBPRINT \
  --ssl-type SNI \
  --hostname doclittle.site
```

---

## 🎯 Complete Command Sequence

```bash
# 1. Wait 30 minutes after adding DNS record

# 2. Verify DNS
dig doclittle.site

# 3. Add domain to Azure
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site

# 4. Create SSL certificate
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site

# 5. Get thumbprint and bind
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doclittle.site \
  --query thumbprint --output tsv)

az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint $THUMBPRINT \
  --ssl-type SNI \
  --hostname doclittle.site

# 6. Test
curl https://doclittle.site
```

---

**IP Address:** `20.99.227.36`  
**Status:** Ready to configure in IONOS

