# doclittle.site DNS & SSL Fix

## Current Issue

**Problem:** `doclittle.site` domain is added to Azure but SSL certificate cannot be created because the A record points to the wrong IP address.

**Current DNS:**
- A Record: `doclittle.site` → `20.99.227.36` (OLD IP ❌)

**Required DNS:**
- A Record: `doclittle.site` → `20.115.232.16` (CURRENT AZURE IP ✅)

---

## Step 1: Update A Record in IONOS

### IONOS DNS Configuration

1. **Log in to IONOS:** https://www.ionos.com
2. **Go to DNS Settings:** https://my.ionos.com/domain-dns-settings/doclittle.site
3. **Find the A Record for root domain** (`@` or `doclittle.site`)
4. **Update the IP address:**

   **Current (WRONG):**
   - Type: `A`
   - Name: `@` (or blank for root)
   - Value: `20.99.227.36` ❌

   **Change to (CORRECT):**
   - Type: `A`
   - Name: `@` (or blank for root)
   - Value: `20.115.232.16` ✅
   - TTL: `3600` (or default)

5. **Save** the record

---

## Step 2: Verify DNS Propagation

Wait 5-15 minutes, then verify:

```bash
dig A doclittle.site +short
```

**Expected output:**
```
20.115.232.16
```

Or use online tool:
- https://dnschecker.org/#A/doclittle.site
- Should show `20.115.232.16` globally

---

## Step 3: Create SSL Certificate (After DNS Updates)

Once DNS points to the correct IP, create the SSL certificate:

```bash
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site
```

**Note:** This may take 10-30 minutes for Azure to verify and issue the certificate.

---

## Step 4: Check Certificate Status

```bash
az webapp config ssl list \
  --resource-group doclittle \
  --name doclittle \
  --query "[?name=='doclittle.site']" \
  --output table
```

**Wait for status to be `Issued`** before proceeding.

---

## Step 5: Bind SSL Certificate

Once certificate status is `Issued`, bind it:

```bash
# Get certificate thumbprint
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --name doclittle \
  --certificate-name doclittle.site \
  --query thumbprint \
  --output tsv)

# Bind certificate
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint "$THUMBPRINT" \
  --ssl-type SNI \
  --hostname doclittle.site
```

---

## Step 6: Verify SSL is Working

**Test HTTPS:**
```bash
curl -I https://doclittle.site
```

**Expected:**
```
HTTP/2 200
...
```

**In Browser:**
- Visit: https://doclittle.site
- Should show green padlock (valid SSL)
- Should serve the unified dashboard landing page

---

## Current Status

✅ **Domain added to Azure:** `doclittle.site` (Verified)  
❌ **A Record:** Points to wrong IP (`20.99.227.36`)  
❌ **SSL Certificate:** Not created yet (blocked by DNS)  
⏳ **Action Required:** Update A record in IONOS to `20.115.232.16`

---

## Quick Reference

### IONOS A Record to Update:
```
Type: A
Name: @ (root domain)
Value: 20.115.232.16  (UPDATE FROM 20.99.227.36)
TTL: 3600
```

### Commands (Run after DNS is updated):
```bash
# 1. Verify DNS
dig A doclittle.site +short
# Should return: 20.115.232.16

# 2. Create SSL certificate
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site

# 3. Check status (wait 10-30 minutes)
az webapp config ssl list \
  --resource-group doclittle \
  --name doclittle \
  --query "[?name=='doclittle.site']"

# 4. Bind certificate (after status is "Issued")
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --name doclittle \
  --certificate-name doclittle.site \
  --query thumbprint --output tsv)

az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint "$THUMBPRINT" \
  --ssl-type SNI \
  --hostname doclittle.site
```

---

**Last Updated:** November 18, 2025

