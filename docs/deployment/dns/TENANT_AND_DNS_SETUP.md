# Tenant Subdomain & DNS Setup

**Last Updated:** April 6, 2026

Merged from: TENANT_SUBDOMAIN_SETUP, SUBDOMAIN_SSL_FIX, WILDCARD_DNS_EXPLANATION.

---

## 1. Overview

For each tenant subdomain (e.g. `doctor-little.doclittle.site`):

1. Add CNAME in IONOS
2. Add custom domain in Azure
3. Create SSL certificate
4. Bind SSL certificate

**Automated:** `./scripts/add-tenant-subdomain.sh doctor-little`

---

## 2. Wildcard DNS vs Azure Custom Domains

**Wildcard CNAME** (`* → doclittle.azurewebsites.net`) routes all subdomains to Azure but:
- ❌ Does NOT add subdomains as custom domains in Azure
- ❌ Does NOT create SSL certificates

**Each subdomain must be added in Azure** and needs its own SSL cert (or wildcard cert).

---

## 3. Manual Steps

### CNAME in IONOS
- Name: `doctor-little`
- Value: `doclittle.azurewebsites.net`

### Add Domain in Azure
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doctor-little.doclittle.site
```

### SSL Certificate
```bash
az webapp config ssl create --resource-group doclittle --name doclittle \
  --hostname doctor-little.doclittle.site
az webapp config ssl bind --resource-group doclittle --name doclittle \
  --certificate-thumbprint <THUMBPRINT> --ssl-type SNI \
  --hostname doctor-little.doclittle.site
```

---

## 4. SSL Fix (NET::ERR_CERT_COMMON_NAME_INVALID)

**Options:**
1. **Cloudflare** — Provides free SSL for all subdomains; point nameservers to Cloudflare
2. **Azure Wildcard** — Purchase/upload `*.doclittle.site` cert
3. **Per-subdomain** — Create and bind cert per tenant (as above)

---

## 5. Related

- [IONOS_DNS_SETUP](./ionos/IONOS_DNS_SETUP.md)
- [AUTOMATED_TENANT_DOMAIN_SETUP](../azure/AUTOMATED_TENANT_DOMAIN_SETUP.md)
