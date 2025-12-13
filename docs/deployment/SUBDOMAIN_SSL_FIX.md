# Subdomain SSL Certificate Fix

**Issue**: `NET::ERR_CERT_COMMON_NAME_INVALID` for tenant subdomains (e.g., `doctor-little.doclittle.site`)

**Root Cause**: Azure App Service managed certificates only cover the root domain, not wildcard subdomains.

---

## 🎯 Solution Options

### Option 1: Cloudflare (Recommended for Multi-Tenant SaaS) ⭐

Cloudflare automatically provides SSL certificates for all subdomains, including wildcards.

#### Steps:

1. **Sign up for Cloudflare** (free plan works)
   - Go to https://cloudflare.com
   - Add your domain `doclittle.site`

2. **Update DNS Nameservers**
   - Cloudflare will provide nameservers (e.g., `ns1.cloudflare.com`)
   - Update nameservers in IONOS to point to Cloudflare

3. **Configure DNS Records in Cloudflare**
   ```
   Type    Name              Content                      Proxy
   A       @                 <Azure IP>                   ✅ Proxied
   CNAME   api               doclittle.azurewebsites.net  ✅ Proxied
   CNAME   www               doclittle.site                ✅ Proxied
   ```

4. **Enable SSL/TLS**
   - Go to SSL/TLS settings
   - Set to "Full" or "Full (strict)"
   - Cloudflare will automatically issue certificates for all subdomains

5. **Update Azure Custom Domains**
   - In Azure Portal → App Service → Custom domains
   - Add `*.doclittle.site` (if supported) or add each subdomain individually

**Benefits:**
- ✅ Automatic SSL for all subdomains
- ✅ Free wildcard certificates
- ✅ DDoS protection
- ✅ CDN caching
- ✅ No certificate management needed

---

### Option 2: Azure App Service Certificate (Wildcard)

Purchase a wildcard certificate from Azure or upload your own.

#### Steps:

1. **Purchase/Upload Wildcard Certificate**
   ```bash
   # Option A: Purchase from Azure
   az webapp config ssl create \
     --resource-group doclittle \
     --name doclittle \
     --hostname "*.doclittle.site"
   
   # Option B: Upload your own wildcard certificate
   az webapp config ssl upload \
     --resource-group doclittle \
     --name doclittle \
     --certificate-file wildcard.pfx \
     --certificate-password <password>
   ```

2. **Bind Certificate**
   ```bash
   az webapp config ssl bind \
     --resource-group doclittle \
     --name doclittle \
     --certificate-thumbprint <THUMBPRINT> \
     --ssl-type SNI \
     --hostname "*.doclittle.site"
   ```

**Note**: Azure App Service may not support wildcard hostname binding directly. You may need to bind individual subdomains.

---

### Option 3: Let's Encrypt Wildcard Certificate (Manual)

Use certbot to generate a wildcard certificate and upload to Azure.

#### Steps:

1. **Install certbot**
   ```bash
   sudo apt-get update
   sudo apt-get install certbot
   ```

2. **Generate Wildcard Certificate**
   ```bash
   certbot certonly --manual --preferred-challenges dns \
     -d "*.doclittle.site" -d "doclittle.site"
   ```

3. **Add DNS TXT Record**
   - Certbot will ask you to add a TXT record to verify domain ownership
   - Add the record in IONOS DNS settings
   - Wait for propagation, then continue

4. **Convert to PFX for Azure**
   ```bash
   openssl pkcs12 -export \
     -out wildcard.pfx \
     -inkey privkey.pem \
     -in cert.pem \
     -certfile chain.pem
   ```

5. **Upload to Azure**
   ```bash
   az webapp config ssl upload \
     --resource-group doclittle \
     --name doclittle \
     --certificate-file wildcard.pfx \
     --certificate-password <password>
   ```

---

### Option 4: Individual Certificates (Not Scalable)

Create a certificate for each subdomain as tenants are added.

**Not recommended** - Too much manual work for multi-tenant SaaS.

---

## 🚀 Quick Fix for Current Tenant

For immediate access to `doctor-little.doclittle.site`:

### Temporary Workaround:

1. **Add CNAME Record in IONOS**
   ```
   Type: CNAME
   Name: doctor-little
   Value: doclittle.azurewebsites.net
   TTL: 3600
   ```

2. **Add Custom Domain in Azure**
   ```bash
   az webapp config hostname add \
     --resource-group doclittle \
     --webapp-name doclittle \
     --hostname doctor-little.doclittle.site
   ```

3. **Create Certificate for This Subdomain**
   ```bash
   az webapp config ssl create \
     --resource-group doclittle \
     --name doclittle \
     --hostname doctor-little.doclittle.site
   ```

4. **Bind Certificate**
   ```bash
   az webapp config ssl bind \
     --resource-group doclittle \
     --name doclittle \
     --certificate-thumbprint <THUMBPRINT> \
     --ssl-type SNI \
     --hostname doctor-little.doclittle.site
   ```

**Note**: This is a temporary fix. You'll need to repeat for each new tenant.

---

## ✅ Recommended Solution

**Use Cloudflare** (Option 1) for the best long-term solution:
- Automatic SSL for all subdomains
- No manual certificate management
- Better performance with CDN
- Free DDoS protection
- Scales automatically as you add tenants

---

## 📝 Verification

After implementing the fix:

1. **Test SSL**
   ```bash
   curl -I https://doctor-little.doclittle.site
   ```

2. **Check Certificate**
   ```bash
   openssl s_client -connect doctor-little.doclittle.site:443 -servername doctor-little.doclittle.site
   ```

3. **Verify in Browser**
   - Visit `https://doctor-little.doclittle.site`
   - Should show green padlock
   - No certificate errors

---

## 🔗 Related Documentation

- [Azure SSL Setup](./DEPLOYMENT_GUIDE.md#step-1d-create-ssl-certificate)
- [DNS Configuration](./dns/ionos/IONOS_DNS_CONFIGURATION.md)
- [Azure Custom Domains](https://docs.microsoft.com/en-us/azure/app-service/app-service-web-tutorial-custom-domain)

---

**Last Updated**: December 2024  
**Status**: Ready for Implementation




