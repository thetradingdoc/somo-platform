# doclittle.site SSL & Domain Setup

## Current Status
- ✅ `api.doclittle.site` is configured and working with SSL
- ❌ `doclittle.site` (root domain) is NOT configured yet
- ❌ SSL certificate not created for root domain

---

## Step 1: Add Azure Verification TXT Record in IONOS

**REQUIRED** - Azure needs this to verify domain ownership before adding the domain.

### IONOS DNS Configuration

1. **Log in to IONOS:** https://www.ionos.com
2. **Go to DNS Settings:** https://my.ionos.com/domain-dns-settings/doclittle.site
3. **Add TXT Record:**

   **Configuration:**
   - **Type:** `TXT`
   - **Name:** `asuid.doclittle.site` (or just `asuid` if IONOS adds `.doclittle.site` automatically)
   - **Value:** `e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2`
   - **TTL:** `3600` (or default)

4. **Save** the record

**Visual Guide:**
```
Type:     [TXT ▼]
Name:     [asuid.doclittle.site]
Value:    [e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2]
TTL:      [3600]
```

**Note:** This is different from the `asuid.api` TXT record. You need BOTH:
- `asuid.api` → Already exists (for api.doclittle.site)
- `asuid.doclittle.site` → **NEW** (for root domain)

---

## Step 2: Wait for DNS Propagation

**Wait 5-15 minutes** for the TXT record to propagate.

**Verify TXT record:**
```bash
dig TXT asuid.doclittle.site +short
```

**Expected output:**
```
"e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2"
```

Or use online tool:
https://dnschecker.org/#TXT/asuid.doclittle.site

---

## Step 3: Add Domain in Azure (After TXT Record Propagates)

Once the TXT record is verified, add the domain:

```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site
```

**Expected Output:**
```
{
  "name": "doclittle.site",
  "slot": "production"
}
```

---

## Step 4: Create App Service Managed SSL Certificate

Azure will automatically create and manage the SSL certificate:

```bash
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site
```

**Note:** This may take 10-30 minutes. Azure needs to:
1. Verify domain ownership (TXT record)
2. Request certificate from Certificate Authority
3. Issue and install certificate

---

## Step 5: Bind SSL Certificate (After Certificate is Created)

**Check certificate status:**
```bash
az webapp config ssl list \
  --resource-group doclittle \
  --query "[?name=='doclittle.site']" \
  --output table
```

**Wait for status to be `Issued`**, then bind:

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
- No SSL warnings

---

## Quick Reference

### TXT Record to Add (IONOS)
```
Type: TXT
Name: asuid.doclittle.site
Value: e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2
```

### Commands (Run in order after TXT record propagates)
```bash
# 1. Add domain
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site

# 2. Create SSL certificate
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site

# 3. Wait 10-30 minutes, then check status
az webapp config ssl list \
  --resource-group doclittle \
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

## Troubleshooting

### Error: "TXT record not found"
**Solution:** 
- Wait 5-15 minutes after adding TXT record
- Verify with: `dig TXT asuid.doclittle.site`
- Check IONOS saved the record correctly

### Certificate Status Stays "PendingIssuance"
**Solution:**
- Wait up to 30 minutes (can take time)
- Verify TXT record still exists
- Check Azure App Service logs: `az webapp log tail --name doclittle --resource-group doclittle`

### Domain Added but SSL Not Working
**Solution:**
- Verify certificate is created: `az webapp config ssl list`
- Check certificate is bound to domain
- Wait for SSL to propagate (can take 5-10 minutes after binding)

---

## Current DNS Records Summary

**Should have these records in IONOS:**

| Type | Name | Value | Status |
|------|------|-------|--------|
| A | `@` | `20.99.227.36` | ✅ Exists |
| CNAME | `api` | `doclittle.azurewebsites.net` | ✅ Exists |
| TXT | `asuid.api` | `e81a8b...` | ✅ Exists |
| **TXT** | **`asuid.doclittle.site`** | **`e81a8b...`** | **❌ NEED TO ADD** |

---

**Status:** ⏳ Waiting for TXT record to be added in IONOS  
**Next Step:** Add `asuid.doclittle.site` TXT record in IONOS DNS settings

