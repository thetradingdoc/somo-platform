# Production Deployment - Per-Client API Keys & Admin Portal

## 🚀 Quick Deployment to api.doclittle.site

### Step 1: Set ADMIN_PORTAL_SECRET in Azure

**Generate a secure secret:**
```bash
openssl rand -hex 32
```

**Set in Azure Portal:**
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **Resource Groups** → **doclittle** → **doclittle**
3. Click **Configuration** → **Application settings**
4. Click **+ New application setting**
5. Name: `ADMIN_PORTAL_SECRET`
6. Value: `[paste the generated secret]`
7. Click **OK** → **Save**

**Or via Azure CLI:**
```bash
# Generate secret (save this value!)
ADMIN_SECRET=$(openssl rand -hex 32)
echo "Generated ADMIN_PORTAL_SECRET: $ADMIN_SECRET"

# Set in Azure
az webapp config appsettings set \
  --resource-group doclittle \
  --name doclittle \
  --settings ADMIN_PORTAL_SECRET="$ADMIN_SECRET"
```

### Step 2: Deploy Code

**Quick deploy script:**
```bash
cd /path/to/doclittle-platform
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**Manual deploy:**
```bash
cd middleware-platform
zip -r ../deploy.zip . -x "*.git*" -x "node_modules/*" -x "*.env*" -x "*test*" -x "*.md" -x "package-lock.json"

az webapp deployment source config-zip \
  --resource-group doclittle \
  --name doclittle \
  --src ../deploy.zip

rm ../deploy.zip
```

### Step 3: Verify Deployment

**Check app status:**
```bash
az webapp show --name doclittle --resource-group doclittle --query state
```

**View logs:**
```bash
az webapp log tail --name doclittle --resource-group doclittle
```

**Test health endpoint:**
```bash
curl https://api.doclittle.site/health
# Should return: {"status":"ok"}
```

### Step 4: Test Admin Portal

1. **Open admin portal:**
   - URL: `https://api.doclittle.site/admin/portal`
   - You should see the login screen (if `ADMIN_PORTAL_SECRET` is set)

2. **Login:**
   - Enter the `ADMIN_PORTAL_SECRET` you set in Step 1
   - Click "Login"

3. **Verify features:**
   - ✅ Dashboard loads with metrics
   - ✅ Clients section shows client list
   - ✅ "Edit Client" button opens modal
   - ✅ "API Keys" section shows per-client keys
   - ✅ "Generate Key" button works
   - ✅ "Copy Key" shows one-time secret
   - ✅ "Rotate Key" updates client credentials

### Step 5: Test API Key Endpoints

**1. Create a test client:**
```bash
curl -X POST https://api.doclittle.site/api/admin/clients \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=YOUR_SESSION_COOKIE" \
  -d '{
    "name": "Test Client",
    "phone_number": "+15551234567",
    "email": "test@example.com"
  }'
```

**2. Generate API key for client:**
```bash
curl -X POST https://api.doclittle.site/api/admin/clients/{CLINIC_ID}/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=YOUR_SESSION_COOKIE" \
  -d '{
    "name": "Production Key",
    "revoke_existing": false
  }'
```

**3. Test API key authentication:**
```bash
curl https://api.doclittle.site/api/admin/clients \
  -H "X-API-Key: sk_xxxxxxxxxxxxxxxx"
```

## 🔒 Security Checklist

- ✅ `ADMIN_PORTAL_SECRET` is set in Azure (64-character hex string)
- ✅ Admin portal requires authentication
- ✅ API keys are hashed before storage (SHA-256)
- ✅ API keys are only shown once on generation
- ✅ All `/api/admin/*` endpoints are protected
- ✅ Session cookies are secure (HttpOnly, Secure, SameSite)
- ✅ Database migrations ran successfully

## 📋 New Features Deployed

### Admin Portal
- **Per-Client API Key Management**
  - Generate unique API keys per client
  - Rotate keys (with option to revoke existing)
  - View key history (without revealing secrets)
  - Copy one-time key on generation

- **Enhanced Client Management**
  - Edit client configurations
  - View API key status per client
  - Link clients to Retell agents (client 1 → voice agent 1)

### API Endpoints
- `POST /api/admin/clients/:clinicId/api-keys` - Generate API key
- `PUT /api/admin/clients/:clinicId/api-keys/:keyId/rotate` - Rotate key
- `DELETE /api/admin/clients/:clinicId/api-keys/:keyId` - Revoke key
- `GET /api/admin/clients/:clinicId/api-keys` - List keys (masked)
- `POST /api/admin/auth/login` - Admin login
- `POST /api/admin/auth/logout` - Admin logout
- `GET /api/admin/auth/status` - Check session

### Database Schema
- `merchant_api_keys` table created
- Migrations run automatically on startup
- API keys hashed with SHA-256
- Usage tracking enabled

## 🐛 Troubleshooting

### Admin Portal Shows "Unauthorized"
- Check `ADMIN_PORTAL_SECRET` is set in Azure
- Verify you're using the correct secret when logging in
- Check browser console for errors

### API Keys Not Working
- Verify client exists: `GET /api/admin/clients`
- Check key is active: `GET /api/admin/clients/:id/api-keys`
- Verify key format: `sk_` prefix + 64 hex characters
- Check request headers: `X-API-Key` or `Authorization: Bearer`

### Database Migration Errors
- Check logs: `az webapp log tail --name doclittle --resource-group doclittle`
- Verify SQLite database is writable
- Database path: `/home/middleware.db` (Azure)

## 📊 Post-Deployment Monitoring

**Monitor logs for:**
- Database migration success
- Admin portal login attempts
- API key generation/rotation events
- Authentication failures

**Check these endpoints:**
```bash
# Health check
curl https://api.doclittle.site/health

# Admin portal
curl -I https://api.doclittle.site/admin/portal

# API docs
curl -I https://api.doclittle.site/docs
```

---

**Last Updated:** 2025-01-XX  
**Status:** ✅ Ready for Production Deployment

