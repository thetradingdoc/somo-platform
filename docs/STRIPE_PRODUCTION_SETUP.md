# Stripe Production Setup for api.doclittle.site

**Status:** Ready to configure  
**Last Updated:** November 18, 2025

---

## 🔍 Current Status

### Test Results:
✅ **Stripe configuration utility working correctly**  
✅ **Security validation working** - Prevents test keys in production  
✅ **Test keys configured locally** (correct for development)  
⚠️ **Azure currently has TEST keys in production environment**

---

## 📋 Production Keys

### Secret Key:
```
sk_live_... (stored in Azure App Service settings)
```

### Publishable Key:
```
pk_live_... (stored in Azure App Service settings)
```

**⚠️ Note:** Production keys are stored securely in Azure App Service environment variables, not in this documentation. To set them, use the script: `bash scripts/set-stripe-production-keys.sh`

**⚠️ These are LIVE production keys - real money will be processed**

---

## 🚀 Setting Production Keys in Azure

### Option 1: Automated Script (Recommended)

```bash
cd /Users/jeremiahrichie/agentic-commerce-platform
bash scripts/set-stripe-production-keys.sh
```

This script will:
- ✅ Validate keys are production keys (sk_live_ / pk_live_)
- ✅ Set keys in Azure App Service
- ✅ Verify configuration
- ✅ Provide next steps

### Option 2: Manual Azure CLI

```bash
# Use the provided script instead:
bash scripts/set-stripe-production-keys.sh

# Or manually (replace with your actual keys):
az webapp config appsettings set \
  --name doclittle \
  --resource-group doclittle \
  --settings \
    STRIPE_SECRET_KEY="sk_live_..." \
    STRIPE_PUBLISHABLE_KEY="pk_live_..." \
    NODE_ENV="production"
```

### Option 3: Azure Portal

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **App Services** → **doclittle** → **Configuration** → **Application settings**
3. Add/Update:
   - `STRIPE_SECRET_KEY` = `sk_live_...` (get from secure storage)
   - `STRIPE_PUBLISHABLE_KEY` = `pk_live_...` (get from secure storage)
   - `NODE_ENV` = `production`
4. Click **Save**

---

## ✅ Verification

After setting keys, verify with:

```bash
# Check Azure configuration
az webapp config appsettings list \
  --name doclittle \
  --resource-group doclittle \
  --query "[?contains(name, 'STRIPE')].{name:name, value:value}" \
  --output table

# Test API endpoint (after Azure restart)
curl https://api.doclittle.site/api/signup/stripe-config
```

Expected response:
```json
{
  "success": true,
  "publishable_key": "pk_live_...",
  "mode": "production"
}
```

---

## 🔒 Security Features

The system includes automatic validation:

1. **Environment-aware validation:**
   - Production environment requires `sk_live_` / `pk_live_` keys
   - Development environment requires `sk_test_` / `pk_test_` keys
   - Prevents accidental use of production keys in dev

2. **Key format validation:**
   - Validates keys start with correct prefix
   - Ensures secret and publishable keys match (both live or both test)
   - Rejects invalid formats

3. **Startup checks:**
   - Server validates keys on startup
   - Exits with error if validation fails
   - Prevents unsafe configuration

---

## ⚠️ Important Notes

1. **Real Money:** Production keys process real payments - test carefully
2. **Monitoring:** Monitor Stripe dashboard for all transactions
3. **Backup Keys:** Stored in `docs/SECRETS_BACKUP.md` (gitignored)
4. **Rotation:** Rotate keys immediately if ever exposed
5. **Access Control:** Limit who has access to production keys

---

## 🧪 Testing Production Setup

After setting production keys, test with:

1. **Small test payment:** Use a real card with small amount
2. **Verify webhook:** Check Stripe webhooks are received
3. **Check logs:** Monitor Azure logs for errors
4. **Dashboard:** Verify transactions appear in Stripe dashboard

---

**Last Updated:** November 18, 2025

