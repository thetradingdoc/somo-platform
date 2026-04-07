# IONOS DNS Setup — doclittle.site

**Last Updated:** April 6, 2026

Merged from: IONOS_A_RECORD_SETUP, IONOS_DNS_CONFIGURATION.

---

## 1. Root Domain (A Record)

### Get Azure IP
```bash
az webapp show --name doclittle --resource-group doclittle \
  --query "outboundIpAddresses" --output tsv
# Use first IP (e.g. 20.99.227.36)
```

### IONOS Configuration
1. Go to https://my.ionos.com/domain-dns-settings/doclittle.site
2. Add **A Record**: Type `A`, Name `@`, Value `<Azure IP>`, TTL `3600`
3. Save

**Do NOT delete:** `api` CNAME, MX, TXT, `_domainkey` records.

### Verify
```bash
dig doclittle.site
# Should show Azure IP
```

### Add in Azure
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site
```

---

## 2. API Subdomain (CNAME)

- `api` → `doclittle.azurewebsites.net` (for api.doclittle.site)

---

## 3. Tenant Subdomains

See [TENANT_AND_DNS_SETUP.md](../TENANT_AND_DNS_SETUP.md) for adding tenant subdomains (e.g. `doctor-little.doclittle.site`).
