# DocLittle.Site Setup Guide - SaaS Frontend on Azure

## ✅ Architecture Confirmation

**YES - Confirmed Architecture:**

1. **`doclittle.site`** - Main SaaS Site (Root Domain)
   - Frontend: Unified Dashboard (`/unified-dashboard/`)
   - Landing page: `/landing.html`
   - Admin portal: `/admin` (from unified-dashboard/admin)
   - Customer signup: `/signup` (from middleware-platform/public/signup)
   - Main SaaS frontend and backend

2. **`api.doclittle.site`** - API Subdomain (Already Deployed)
   - API endpoints: All `/api/*` routes
   - Documentation: `/docs` (protected)
   - Webhooks: `/webhook/*`
   - Currently deployed to Azure App Service: `doclittle`

---

## 🎯 Deployment Strategy

### Option 1: Single App Service (Recommended)
**Use the same Azure App Service for both domains:**
- Root domain `doclittle.site` → Serves frontend (unified-dashboard)
- API subdomain `api.doclittle.site` → Serves API endpoints

**Advantages:**
- Single App Service = Lower cost
- Shared database and resources
- Easier deployment and management
- Unified logging and monitoring

### Option 2: Separate App Services
**Create separate App Services:**
- App Service 1: `doclittle-site` → Frontend only
- App Service 2: `doclittle` (existing) → API only

**Advantages:**
- Separation of concerns
- Independent scaling
- Different runtime stacks if needed

**Disadvantages:**
- Higher cost (2 App Services)
- More complex deployment
- Separate databases needed

---

## 🚀 Implementation: Option 1 (Single App Service)

### Step 1: Update server.js to Serve Frontend

Add route to serve unified-dashboard from root domain:

```javascript
// In middleware-platform/server.js

// Serve frontend from root domain (doclittle.site)
app.get('/', (req, res) => {
  // Check if request is for root domain or API subdomain
  const host = req.headers.host;
  
  if (host === 'doclittle.site' || host === 'www.doclittle.site') {
    // Serve unified dashboard frontend
    res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
  } else if (host === 'api.doclittle.site') {
    // API subdomain - serve signup page (or API info)
    res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
  } else {
    // Default to landing page
    res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
  }
});

// Serve unified-dashboard static files
app.use('/assets', express.static(path.join(__dirname, '..', 'unified-dashboard', 'assets')));
app.use('/business', express.static(path.join(__dirname, '..', 'unified-dashboard', 'business')));
app.use('/patients', express.static(path.join(__dirname, '..', 'unified-dashboard', 'patients')));
app.use('/insurer', express.static(path.join(__dirname, '..', 'unified-dashboard', 'insurer')));
app.use('/admin', express.static(path.join(__dirname, '..', 'unified-dashboard', 'admin')));

// Serve unified-dashboard HTML pages
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'login.html'));
});

// Admin portal route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'admin', 'index.html'));
});
```

### Step 2: Configure DNS in IONOS

Add DNS records for root domain `doclittle.site`:

**CNAME Record:**
- **Type:** CNAME
- **Name/Host:** `@` (or leave blank for root domain)
- **Value/Points to:** `doclittle.azurewebsites.net`
- **TTL:** 3600

**Note:** Some DNS providers don't allow CNAME on root domain. If IONOS doesn't support CNAME on root:
- Use **A Record** pointing to Azure App Service IP
- Or use **ALIAS Record** if supported
- Or use Azure **App Service Domain** for easier setup

**Alternative: Use Azure App Service Domain (Easier)**
1. Go to Azure Portal → App Service → Custom domains
2. Click **"Buy App Service Domain"**
3. Search for `doclittle.site` (if available)
4. Azure will automatically configure DNS

### Step 3: Add Root Domain in Azure App Service

```bash
# Add custom domain
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doclittle.site

# Verify DNS (Azure will check if domain resolves)
az webapp config hostname list \
  --resource-group doclittle \
  --webapp-name doclittle
```

**Or via Azure Portal:**
1. Go to Azure Portal → App Service `doclittle`
2. Click **Custom domains** → **+ Add custom domain**
3. Enter: `doclittle.site`
4. Azure will verify DNS automatically

### Step 4: Create SSL Certificate for Root Domain

```bash
# Create managed certificate for root domain
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname doclittle.site

# Get certificate thumbprint
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doclittle.site \
  --query thumbprint

# Bind certificate to domain
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --hostname doclittle.site
```

### Step 5: Update Environment Variables

Add to Azure App Service Configuration:

```bash
# Frontend configuration
FRONTEND_BASE_URL=https://doclittle.site
API_BASE_URL=https://api.doclittle.site

# Enable frontend serving
SERVE_FRONTEND=true
```

---

## 🎨 Frontend Configuration

### Update API Base URL in Frontend

Edit `unified-dashboard/assets/js/config.js`:

```javascript
// Production configuration
const API_BASE_URL = 'https://api.doclittle.site';
const FRONTEND_BASE_URL = 'https://doclittle.site';

// Development configuration (for local testing)
// const API_BASE_URL = 'http://localhost:4000';
// const FRONTEND_BASE_URL = 'http://localhost:8000';
```

---

## 📋 DNS Configuration Summary

### IONOS DNS Records for `doclittle.site`:

**Root Domain (`doclittle.site`):**
- **A Record** or **ALIAS** → Azure App Service IP or `doclittle.azurewebsites.net`
- **OR** Use Azure App Service Domain (recommended)

**API Subdomain (`api.doclittle.site`):** ✅ Already configured
- **CNAME:** `api` → `doclittle.azurewebsites.net`

**TXT Records:**
- `asuid` → Azure App Service verification (if using Azure domain)
- SPF, DKIM records for email (if needed)

---

## 🔧 Server.js Route Structure

```javascript
// Middleware-platform/server.js structure:

// Root domain (doclittle.site) - Frontend
app.get('/', (req, res) => {
  const host = req.headers.host;
  if (host === 'doclittle.site' || host === 'www.doclittle.site') {
    return res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
  }
  // API subdomain handled by signup routes
});

// Unified Dashboard routes
app.use('/assets', express.static(path.join(__dirname, '..', 'unified-dashboard', 'assets')));
app.use('/business', express.static(path.join(__dirname, '..', 'unified-dashboard', 'business')));
app.use('/patients', express.static(path.join(__dirname, '..', 'unified-dashboard', 'patients')));
app.use('/admin', express.static(path.join(__dirname, '..', 'unified-dashboard', 'admin')));

// API subdomain (api.doclittle.site) - API endpoints
// Routes defined in routes/signup.js handle signup
// API routes handle all /api/* endpoints
```

---

## 📊 URL Structure

| Domain | Path | Purpose |
|--------|------|---------|
| `doclittle.site` | `/` | Landing page |
| `doclittle.site` | `/login` | Login page |
| `doclittle.site` | `/admin` | Admin portal |
| `doclittle.site` | `/business/*` | Business dashboard |
| `doclittle.site` | `/patients/*` | Patient portal |
| `api.doclittle.site` | `/` | Signup page |
| `api.doclittle.site` | `/docs` | API documentation (protected) |
| `api.doclittle.site` | `/api/*` | API endpoints |
| `api.doclittle.site` | `/webhook/*` | Webhooks |

---

## 🚀 Deployment Checklist

### Before Deploying:

- [ ] Update `server.js` to serve unified-dashboard
- [ ] Update `unified-dashboard/assets/js/config.js` with production API URL
- [ ] Test routes locally
- [ ] Deploy code to Azure

### Azure Configuration:

- [ ] Add `doclittle.site` as custom domain in Azure
- [ ] Configure DNS in IONOS (A record or ALIAS)
- [ ] Create SSL certificate for `doclittle.site`
- [ ] Bind SSL certificate to domain
- [ ] Verify DNS propagation

### Testing:

- [ ] Visit `https://doclittle.site` → Should show landing page
- [ ] Visit `https://doclittle.site/admin` → Should show admin portal
- [ ] Visit `https://api.doclittle.site` → Should show signup page
- [ ] Visit `https://api.doclittle.site/docs` → Should show API docs (if authenticated)
- [ ] Test API calls: `curl https://api.doclittle.site/health`

---

## 🔍 Troubleshooting

### DNS Not Resolving
```bash
# Check DNS propagation
dig doclittle.site
nslookup doclittle.site

# Should point to Azure App Service IP
```

### SSL Certificate Issues
```bash
# List SSL certificates
az webapp config ssl list \
  --resource-group doclittle \
  --name doclittle

# Check certificate binding
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name doclittle.site
```

### Frontend Not Loading
- Check that routes are configured correctly in `server.js`
- Verify static file paths
- Check browser console for errors
- Verify `API_BASE_URL` in frontend config

---

## 💰 Cost Estimation

### Single App Service (Current Setup):
- **Basic B1 SKU:** ~$13/month
- **Free SSL:** Included (managed certificates)
- **Custom domains:** First 5 domains free
- **Total:** ~$13/month

### If Using Separate App Services:
- **App Service 1 (Frontend):** ~$13/month
- **App Service 2 (API):** ~$13/month
- **Total:** ~$26/month

---

## 📝 Next Steps

1. **Update server.js** to serve unified-dashboard
2. **Configure DNS** in IONOS for root domain
3. **Add custom domain** in Azure
4. **Create SSL certificate** for `doclittle.site`
5. **Deploy code** and test
6. **Update frontend config** with production URLs

---

**Status:** 📋 Planning  
**Last Updated:** January 2025

