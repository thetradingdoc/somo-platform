# Azure Environment Variables for Automated Domain Setup

**Last Updated**: December 2024

---

## 📋 Required Variables

Add these to your `.env` file (or Azure App Settings in production):

```bash
# ============================================
# Azure App Service Configuration
# ============================================

# Root domain (e.g., doclittle.site)
AZURE_ROOT_DOMAIN=doclittle.site

# Azure App Service name
AZURE_APP_NAME=doclittle

# Azure Resource Group name
AZURE_RESOURCE_GROUP=doclittle

# ============================================
# SSL Certificate Configuration (Optional)
# ============================================

# Set to 'true' to skip SSL setup in development
# Default: false (SSL will be set up automatically)
AZURE_SKIP_SSL=false

# Maximum retries for SSL certificate creation
# Default: 3
AZURE_SSL_MAX_RETRIES=3

# Delay between SSL retries (milliseconds)
# Default: 60000 (1 minute)
AZURE_SSL_RETRY_DELAY_MS=60000
```

---

## 🔧 Default Values

If you don't set these variables, the system uses these defaults:

- `AZURE_ROOT_DOMAIN` → `doclittle.site`
- `AZURE_APP_NAME` → `doclittle`
- `AZURE_RESOURCE_GROUP` → `doclittle`
- `AZURE_SKIP_SSL` → `false`
- `AZURE_SSL_MAX_RETRIES` → `3`
- `AZURE_SSL_RETRY_DELAY_MS` → `60000` (1 minute)

**So if your Azure setup matches these defaults, you don't need to add anything!**

---

## 📝 Example `.env` File

Here's what your `.env` might look like with Azure variables:

```bash
# Existing variables...
NODE_ENV=production
PORT=4000
DATABASE_URL=...

# Azure Configuration
AZURE_ROOT_DOMAIN=doclittle.site
AZURE_APP_NAME=doclittle
AZURE_RESOURCE_GROUP=doclittle

# Optional: Skip SSL in development
# AZURE_SKIP_SSL=true

# Optional: Adjust retry behavior
# AZURE_SSL_MAX_RETRIES=5
# AZURE_SSL_RETRY_DELAY_MS=120000
```

---

## 🚀 Azure App Settings (Production)

In Azure Portal, add these as **App Settings**:

1. Go to **Azure Portal** → Your App Service (`doclittle`)
2. Navigate to **Configuration** → **Application settings**
3. Click **+ New application setting**
4. Add each variable:

| Name | Value | Example |
|------|-------|---------|
| `AZURE_ROOT_DOMAIN` | Your root domain | `doclittle.site` |
| `AZURE_APP_NAME` | App Service name | `doclittle` |
| `AZURE_RESOURCE_GROUP` | Resource group | `doclittle` |
| `AZURE_SKIP_SSL` | `false` or `true` | `false` |
| `AZURE_SSL_MAX_RETRIES` | Number (optional) | `3` |
| `AZURE_SSL_RETRY_DELAY_MS` | Milliseconds (optional) | `60000` |

5. Click **Save**
6. Restart the App Service

---

## ✅ Verification

After adding variables, verify they're loaded:

```javascript
// In your code or Node REPL
console.log('AZURE_ROOT_DOMAIN:', process.env.AZURE_ROOT_DOMAIN);
console.log('AZURE_APP_NAME:', process.env.AZURE_APP_NAME);
console.log('AZURE_RESOURCE_GROUP:', process.env.AZURE_RESOURCE_GROUP);
```

Or check in Azure Portal:
- **Configuration** → **Application settings** → Search for `AZURE_`

---

## 🔍 Troubleshooting

### Variables Not Loading

1. **Check `.env` file location**
   - Should be in `middleware-platform/` directory
   - Or root directory (if using `dotenv` from root)

2. **Check Azure App Settings**
   - Variables must be set in **Application settings** (not Connection strings)
   - Restart App Service after adding variables

3. **Check Environment**
   - Local: Uses `.env` file
   - Production: Uses Azure App Settings

### Using Defaults

If variables aren't set, the system will:
- ✅ Use default values (see above)
- ✅ Still work for most setups
- ⚠️ Log warnings if Azure CLI is not available

---

## 📚 Related Documentation

- [Automated Tenant Domain Setup](./AUTOMATED_TENANT_DOMAIN_SETUP.md) - How the automation works
- [Tenant Subdomain Setup Guide](./TENANT_SUBDOMAIN_SETUP.md) - Manual setup instructions

---

**Last Updated**: December 2024


