# Automated Tenant Domain Setup

**Last Updated**: December 2024  
**Status**: ✅ Implemented

---

## 🎯 Overview

When a new tenant signs up, the system automatically:
1. ✅ Sends welcome email with subdomain
2. ✅ **Adds custom domain to Azure App Service**
3. ✅ **Creates SSL certificate**
4. ✅ **Binds SSL certificate to domain**

This eliminates manual setup for each new tenant!

---

## 🔧 How It Works

### Signup Flow Integration

When a tenant completes signup in `server.js`:

```javascript
// After welcome email is sent:
AzureDomainService.setupTenantDomain(subdomain, {
  rootDomain: 'doclittle.site',
  appName: 'doclittle',
  resourceGroup: 'doclittle'
});
```

### Automated Steps

1. **Add Custom Domain** → Azure App Service
2. **Wait for DNS Verification** → 30 seconds
3. **Create SSL Certificate** → Azure managed certificate
4. **Wait for Certificate Issuance** → Up to 3 retries (1 min each)
5. **Bind SSL Certificate** → Enable HTTPS

---

## ⚙️ Configuration

### Environment Variables

Add these to your Azure App Settings (or `.env` for local):

```bash
# Azure Configuration (optional - defaults provided)
AZURE_ROOT_DOMAIN=doclittle.site
AZURE_APP_NAME=doclittle
AZURE_RESOURCE_GROUP=doclittle

# SSL Configuration (optional)
AZURE_SKIP_SSL=false              # Set to 'true' to skip SSL in dev
AZURE_SSL_MAX_RETRIES=3           # Max retries for certificate creation
AZURE_SSL_RETRY_DELAY_MS=60000    # Delay between retries (1 minute)
```

### Azure CLI Requirements

The automation requires:
- ✅ Azure CLI installed (`az` command)
- ✅ Logged into Azure (`az login`)
- ✅ Proper permissions to manage App Service

**Check setup:**
```bash
az account show  # Should show your subscription
```

---

## 📋 Prerequisites

### 1. Azure CLI Installation

**macOS:**
```bash
brew install azure-cli
```

**Linux:**
```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

**Windows:**
```powershell
# Via PowerShell
Invoke-WebRequest -Uri https://aka.ms/installazurecliwindows -OutFile .\AzureCLI.msi
```

### 2. Azure Login

```bash
az login
```

For CI/CD (non-interactive):
```bash
az login --service-principal \
  --username <app-id> \
  --password <password> \
  --tenant <tenant-id>
```

### 3. Required Permissions

The Azure account needs:
- ✅ `Website Contributor` role on App Service
- ✅ `Contributor` role on Resource Group (for SSL certificates)

---

## 🚀 Usage

### Automatic (Default)

**No action needed!** The system automatically sets up domains when tenants sign up.

### Manual Trigger (if needed)

```javascript
const AzureDomainService = require('./services/azure-domain-service');

const result = await AzureDomainService.setupTenantDomain('doctor-little', {
  rootDomain: 'doclittle.site',
  appName: 'doclittle',
  resourceGroup: 'doclittle'
});

console.log(result);
// {
//   success: true,
//   subdomain: 'doctor-little',
//   domain: 'doctor-little.doclittle.site',
//   steps: {
//     customDomain: { success: true, ... },
//     sslCertificate: { success: true, thumbprint: '...' },
//     sslBinding: { success: true, ... }
//   }
// }
```

---

## 🔍 Monitoring & Logs

### Success Logs

```
✅ Welcome email sent to user@example.com with subdomain: doctor-little
🌐 Starting automated Azure domain setup for subdomain: doctor-little
✅ Custom domain doctor-little.doclittle.site added to Azure App Service
📝 Creating SSL certificate for doctor-little.doclittle.site...
✅ SSL certificate created for doctor-little.doclittle.site (thumbprint: ABC123...)
✅ SSL certificate bound to doctor-little.doclittle.site
✅ Azure domain setup completed for doctor-little.doctor-little.doclittle.site
```

### Error Handling

The automation is **non-blocking**:
- ✅ Signup completes even if Azure setup fails
- ⚠️ Errors are logged but don't prevent tenant creation
- 🔧 Manual setup can be done later if needed

**Common Issues:**

1. **Azure CLI not installed**
   ```
   ⚠️  Skipping Azure domain setup: Azure CLI not installed
   ```

2. **Not logged in**
   ```
   ⚠️  Skipping Azure domain setup: Not logged into Azure
   ```

3. **DNS not propagated**
   ```
   ⚠️  SSL certificate creation failed: DNS verification failed
   ```
   **Solution:** Wait 5-30 minutes for DNS propagation, then retry manually

4. **Certificate taking too long**
   ```
   ⚠️  SSL certificate created but thumbprint not available after 3 retries
   ```
   **Solution:** Certificate is created but may take longer. Check Azure Portal.

---

## 🛠️ Troubleshooting

### Check Azure Setup

```bash
# Check if Azure CLI is installed
which az

# Check if logged in
az account show

# Check App Service
az webapp show --name doclittle --resource-group doclittle
```

### Verify Domain Setup

```bash
# List custom domains
az webapp config hostname list \
  --webapp-name doclittle \
  --resource-group doclittle

# Check SSL certificates
az webapp config ssl list \
  --resource-group doclittle
```

### Manual Retry

If automation fails, use the manual script:

```bash
./scripts/fix-doctor-little-ssl.sh
```

Or use the Azure service directly:

```javascript
const AzureDomainService = require('./services/azure-domain-service');
await AzureDomainService.setupTenantDomain('doctor-little');
```

---

## 🔐 Security Notes

1. **Azure Credentials**: Never commit Azure credentials to code
2. **Service Principal**: Use service principal for CI/CD (not personal account)
3. **Permissions**: Use least-privilege access (only App Service permissions needed)
4. **SSL Certificates**: Azure managed certificates are free and auto-renewed

---

## 📊 Status Tracking

The automation tracks each step:

```javascript
{
  success: true,
  subdomain: 'doctor-little',
  domain: 'doctor-little.doclittle.site',
  steps: {
    customDomain: {
      success: true,
      alreadyExists: false,
      domain: 'doctor-little.doclittle.site'
    },
    sslCertificate: {
      success: true,
      alreadyExists: false,
      domain: 'doctor-little.doclittle.site',
      thumbprint: 'ABC123...'
    },
    sslBinding: {
      success: true,
      alreadyBound: false,
      domain: 'doctor-little.doclittle.site',
      thumbprint: 'ABC123...'
    }
  }
}
```

---

## 🎯 Future Enhancements

- [ ] Database table to track domain setup status
- [ ] Admin dashboard to view/manage domain setup
- [ ] Retry queue for failed setups
- [ ] Email notification when setup completes
- [ ] Support for Cloudflare wildcard SSL (alternative)

---

## 📚 Related Documentation

- [Tenant & DNS Setup Guide](../dns/TENANT_AND_DNS_SETUP.md) - Manual setup instructions
- [Wildcard DNS Explanation](./WILDCARD_DNS_EXPLANATION.md) - DNS vs Azure custom domains
- [Tenant & DNS Setup](../dns/TENANT_AND_DNS_SETUP.md) - SSL and subdomain troubleshooting

---

**Last Updated**: December 2024  
**Maintained By**: Development Team


