# Deployment Guide

**Last Updated**: January 27, 2025  
**Status**: Ready for Production Deployment

---

## 🎯 Quick Deploy

### Option 1: Azure (Current Production) ⚡

```bash
cd /path/to/doclittle-platform
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**Or push to GitHub** (auto-deploys if connected):
```bash
git push origin main
```

### Quick Steps Summary

1. **Deploy Code**: Run `./scripts/deploy-to-azure.sh`
2. **Add Root Domain**: Run `./scripts/add-root-domain.sh` (or use Azure Portal)
3. **Configure DNS**: Add A record in IONOS pointing to Azure IP
4. **Create SSL**: After DNS propagates, create managed certificate
5. **Configure Subdomain SSL**: See [SUBDOMAIN_SSL_FIX.md](../dns/SUBDOMAIN_SSL_FIX.md) for tenant subdomains
6. **Verify**: Test all URLs and health endpoints

**⚠️ Important**: Azure managed certificates only cover the root domain. For tenant subdomains (e.g., `doctor-little.doclittle.site`), you need either:
- **Cloudflare** (recommended) - automatic SSL for all subdomains
- **Wildcard certificate** - manual setup required

See [SUBDOMAIN_SSL_FIX.md](../dns/SUBDOMAIN_SSL_FIX.md) for detailed instructions.

See detailed steps below.

---

## 📋 Pre-Deployment Checklist

### ✅ Code Changes
- [x] All hardcoded tenant references removed
- [x] Tenant context middleware created
- [x] Constants file created
- [x] Retell WebSocket uses `clinic_id` consistently
- [x] All changes tested locally
- [x] Invoice billing system implemented
- [x] Multi-tenant routing configured

### ✅ Database Schema
- [x] `merchant_orders` table has all required fields
- [x] `invoices`, `invoice_items`, `invoice_payments` tables created
- [x] `pickup_address`, `pickup_latitude`, `pickup_longitude`, `drop_point` fields
- [x] `delivery_status`, `driver_name`, `driver_phone` fields
- [x] `current_latitude`, `current_longitude`, `current_address` fields
- [x] Migration function adds missing columns on startup

### ✅ Backend API Endpoints
- [x] `POST /api/orders` - Creates orders with pickup/drop point
- [x] `PUT /api/orders/:id` - Updates orders
- [x] `GET /api/orders/:id/tracking` - Gets tracking info
- [x] `POST /api/orders/:id/tracking` - Updates location (with auto-confirm)
- [x] `POST /api/orders/:id/confirm-delivery` - Manual confirmation
- [x] `GET /api/orders/config/maps` - Map provider config
- [x] `POST /api/invoices/create-from-claim` - Create invoice from claim
- [x] `GET /api/invoices` - List invoices with filters
- [x] `POST /api/invoices/:id/send` - Send invoice email
- [x] `POST /api/invoices/:id/payments` - Record payment

### ✅ Services
- [x] Location Verification Service
- [x] Geocoding Service (Nominatim free, Google fallback)
- [x] Delivery Confirmation Service
- [x] Invoice Service with EOB integration
- [x] PDF Invoice Service (optional PDFKit)
- [x] All services have error handling

### ✅ Security
- [x] All order routes require authentication
- [x] Input validation on order creation
- [x] SQL injection protection (parameterized queries)
- [x] Coordinate validation

### ⚠️ Environment Variables to Set

**Required:**
- `NODE_ENV=production`
- `PORT=4000` (or Azure/Railway assigned port)
- `API_BASE_URL=https://doclittle.site` (or your domain)
- `BASE_URL=https://doclittle.site`

**Optional (for backward compatibility):**
- `DEFAULT_TENANT_SUBDOMAIN=akin-dunbar` (if different from default)

**API Keys (if not already set):**
- `RETELL_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `STRIPE_SECRET_KEY`
- `CIRCLE_API_KEY` (if using USDC)
- `STEDI_API_KEY` (if using insurance)

---

## 🚀 Azure Deployment (Recommended)

### Step 1: Deploy Code

```bash
cd /path/to/doclittle-platform
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**What this does:**
- ✅ Packages `middleware-platform` (backend + API)
- ✅ Includes `unified-dashboard` (frontend)
- ✅ Deploys to Azure App Service `doclittle`
- ✅ Excludes `node_modules` (Azure installs them)

### Step 1b: Add Root Domain (if not already added)

```bash
chmod +x scripts/add-root-domain.sh
./scripts/add-root-domain.sh
```

**Or manually:**
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site
```

### Step 1c: Configure DNS in IONOS

1. Go to: https://my.ionos.com/domain-dns-settings/doclittle.site
2. Click **"Add record"**
3. Add **A Record**:
   - **Type:** A
   - **Name/Host:** `@` (or leave blank)
   - **Value/IP:** Get from Azure Portal → App Service `doclittle` → Properties → Outbound IP addresses (use first IP)
   - **TTL:** 3600 (or default)
4. Click **Save**
5. Wait 5-30 minutes for DNS propagation

**Verify DNS:**
```bash
dig doclittle.site
# Should show Azure App Service IP
```

### Step 1d: Create SSL Certificate (After DNS Propagates)

```bash
# Create managed certificate (free)
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site

# Get certificate thumbprint
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doclittle.site \
  --query thumbprint \
  --output tsv

# Bind certificate (replace <THUMBPRINT> with output above)
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --hostname doclittle.site
```

### Step 2: Verify Environment Variables

```bash
# Check current environment variables
az webapp config appsettings list \
  --resource-group doclittle \
  --name doclittle \
  --output table

# Set new environment variable if needed
az webapp config appsettings set \
  --resource-group doclittle \
  --name doclittle \
  --settings DEFAULT_TENANT_SUBDOMAIN=akin-dunbar
```

### Step 3: Monitor Deployment

```bash
# Watch logs in real-time
az webapp log tail --name doclittle --resource-group doclittle

# Check deployment status
az webapp show --name doclittle --resource-group doclittle --query state
```

### Step 4: Test Deployment

```bash
# Health check
curl https://doclittle.site/health

# API check
curl https://api.doclittle.site/health

# Test tenant resolution (should work without hardcoded fallbacks)
curl https://api.doclittle.site/api/voice/products/search \
  -H "Host: akin-dunbar.doclittle.site" \
  -d '{"merchant_id": "your_merchant_id"}'
```

---

## 🚂 Railway Deployment (Alternative)

### Step 1: Connect Repository

1. Go to [Railway Dashboard](https://railway.app)
2. Create new project
3. Connect GitHub repository
4. Select `middleware-platform` as root directory

### Step 2: Configure Environment Variables

In Railway Dashboard → Variables:

```bash
NODE_ENV=production
PORT=4000
API_BASE_URL=https://your-app.railway.app
BASE_URL=https://your-app.railway.app
DEFAULT_TENANT_SUBDOMAIN=akin-dunbar  # Optional
```

### Step 3: Deploy

Railway auto-deploys on git push:

```bash
git add .
git commit -m "Deploy: Fix multi-tenant architecture"
git push origin main
```

### Step 4: Monitor

- View logs in Railway Dashboard
- Check deployment status
- Test endpoints

---

## 🔍 Post-Deployment Verification

### 1. Check Health Endpoints

```bash
# Main health check
curl https://doclittle.site/health

# API health check
curl https://api.doclittle.site/health

# Should return: {"status":"ok"}
```

### 2. Test Tenant Resolution

```bash
# Test with subdomain (should resolve tenant)
curl https://akin-dunbar.doclittle.site/api/voice/products/search \
  -d '{"merchant_id": "test"}'

# Should NOT fallback to hardcoded tenant
# Should return error if merchant not found (not guess)
```

### 3. Test Voice Calls

1. Make a test call to your phone number
2. Check logs for `clinic_id` (not `customer_id`)
3. Verify tenant is resolved correctly

### 4. Check Logs

```bash
# Azure
az webapp log tail --name doclittle --resource-group doclittle

# Look for:
# ✅ "Tenant resolved: subdomain → clinic-xxx"
# ✅ "Using clinic_id: clinic-xxx"
# ❌ Should NOT see: "Using fallback tenant"
```

---

## 🐛 Troubleshooting

### Issue: "Tenant not found" errors

**Cause**: Tenant context middleware can't resolve tenant

**Fix**:
1. Check environment variables are set
2. Verify subdomain routing works
3. Check phone number mapping in database
4. Review logs for tenant resolution method

### Issue: Hardcoded tenant still being used

**Cause**: Old code still running (deployment didn't update)

**Fix**:
1. Verify deployment completed
2. Check file timestamps in Azure/Railway
3. Restart application
4. Clear any caches

### Issue: Voice calls not working

**Cause**: Retell WebSocket handler changes

**Fix**:
1. Check logs for `clinic_id` extraction
2. Verify phone number → clinic mapping
3. Test with explicit `clinic_id` in dynamic variables

### Issue: Database errors

**Cause**: Schema changes (unlikely - no DB changes made)

**Fix**:
1. Check database connection
2. Verify migrations ran
3. Review database logs

---

## 📊 Monitoring Checklist

After deployment, monitor for:

- [ ] No "Tenant not found" errors (unless expected)
- [ ] Logs show `clinic_id` (not `customer_id`)
- [ ] Tenant resolution working (check logs)
- [ ] Voice calls routing correctly
- [ ] Payment flow working
- [ ] No hardcoded fallback warnings

---

## 🔄 Rollback Plan

If issues occur:

### Azure Rollback

```bash
# Option 1: Redeploy previous version
# Use Azure Portal → Deployment Center → History
# Select previous deployment and redeploy

# Option 2: Revert code and redeploy
git revert HEAD
./scripts/deploy-to-azure.sh
```

### Railway Rollback

```bash
# In Railway Dashboard:
# Deployments → Select previous deployment → Redeploy
```

### Quick Fix: Restore Fallback (Emergency Only)

If critical issue, temporarily restore fallback:

```javascript
// In tenant-context.js, change:
allowFallback: false
// To:
allowFallback: true
```

**⚠️ Only use in emergency - this reduces security**

---

## 📝 Deployment Notes

### What Changed

1. **Constants File**: Centralized configuration
2. **Tenant Middleware**: New middleware for tenant resolution
3. **Removed Hardcoded References**: 5 locations updated
4. **Retell WebSocket**: Uses `clinic_id` consistently
5. **Error Handling**: Returns errors instead of guessing

### What Didn't Change

- ✅ No database schema changes
- ✅ No breaking API changes
- ✅ Backward compatible
- ✅ No environment variable requirements (optional)

### Testing Recommendations

1. **Test in Local First** (staging)
   - Verify tenant resolution
   - Test voice calls
   - Check logs

2. **Deploy to Production**
   - Monitor logs closely
   - Test critical flows
   - Watch for errors

3. **Gradual Rollout**
   - Deploy during low-traffic period
   - Monitor for 1-2 hours
   - Have rollback plan ready

---

## 🔗 Related Documentation

- **Architecture Fixes**: `docs/architecture/maintenance/FIXES_APPLIED.md`
- **Architecture Issues**: `docs/architecture/maintenance/ARCHITECTURE_ISSUES.md`
- **Database Migration**: `docs/deployment/database/POSTGRES_MIGRATION.md`
- **Security Setup**: `docs/deployment/security/`

---

## ✅ Deployment Checklist

Before deploying:

- [ ] All code changes committed
- [ ] Local testing passed
- [ ] Environment variables verified
- [ ] Database backup created (if needed)
- [ ] Rollback plan ready
- [ ] Monitoring setup ready

After deploying:

- [ ] Health checks passing
- [ ] Tenant resolution working
- [ ] Voice calls working
- [ ] Payment flow working
- [ ] Logs show correct tenant IDs
- [ ] No errors in logs

---

**Status**: ✅ Ready for Deployment  
**Last Updated**: January 27, 2025

