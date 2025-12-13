# Admin Portal Structure

## Overview

The admin portal is a hybrid system combining:
- **Main Dashboard** (`index.html`) with tabs for quick access to core features
- **Standalone Pages** for complex features that need full-page real estate

## Current Structure (Updated)

### Main Dashboard (`/admin` or `/admin/index.html`)

**Tabs:**
- **Dashboard** - Overview with stats and activity feed
- **Tenants (Clinics)** - Healthcare clinics using the platform (end users)
- **Leads** - Lead search, management, and intelligence
- **Pipeline** - Redirects to `pipeline.html` (standalone page has more features)
- **Clients (API Customers)** - API customers (developers/companies using the API)
- **⚡ Workflows** - Redirects to `workflows.html` (standalone visual builder)

**Note:** Pipeline and Workflows tabs redirect to standalone pages because those features require more screen space and have richer functionality.

### Standalone Pages

1. **`/admin/workflows.html`** - Visual workflow builder with node-based editor
2. **`/admin/pipeline.html`** - Enhanced sales pipeline with drag-and-drop
3. **`/admin/leads.html`** - Lead generation and management (complements Leads tab)
4. **`/admin/clients.html`** - Client and credit management (identical to Clients tab)

**Note:** `clients.html` is functionally identical to the Clients tab in `index.html`. Both are kept for flexibility, but they use the same API endpoints and data structure.

## URL Patterns

### Main Dashboard
- `/admin` → `index.html` (default: Dashboard tab)
- `/admin/index.html` → `index.html` (default: Dashboard tab)
- `/admin?tab=leads` → `index.html` with Leads tab active
- `/admin?tab=clients` → `index.html` with Clients tab active
- `/admin?tab=tenants` → `index.html` with Tenants tab active

### Standalone Pages
All admin pages are accessible ONLY under `/admin/`:
- `/admin/workflows.html` → Workflow builder
- `/admin/pipeline.html` → Sales pipeline
- `/admin/leads.html` → Lead management
- `/admin/clients.html` → Client management

## Navigation Flow

### Sidebar Navigation (Unified)

All pages include a consistent sidebar with icons:
- 🏠 **Dashboard** → `index.html`
- 🏥 **Tenants** → `index.html?tab=tenants`
- 👥 **Leads** → `index.html?tab=leads` or `leads.html`
- 📊 **Pipeline** → `pipeline.html`
- 💼 **Clients** → `index.html?tab=clients` or `clients.html`
- ⚡ **Workflows** → `workflows.html`

**Active State:** The sidebar automatically highlights the current page's icon using JavaScript.

### Tab Navigation (Main Dashboard Only)

Tabs appear at the top of the main dashboard:
- Clicking a tab activates it and shows the corresponding content
- Pipeline and Workflows tabs redirect to standalone pages
- URL parameters (`?tab=name`) can be used to directly open a specific tab

### Breadcrumbs

Standalone pages include breadcrumb navigation:
- `Admin > Workflows`
- `Admin > Pipeline`
- `Admin > Leads`
- `Admin > Clients`

## File Locations

```
unified-dashboard/admin/
├── index.html          # Main dashboard with tabs
├── workflows.html      # Visual workflow builder
├── pipeline.html       # Sales pipeline
├── leads.html          # Lead management
└── clients.html        # Client management
```

## Routing Configuration

### Server-Side (`middleware-platform/server.js`)

The server handles routing for admin pages:

```javascript
// Serve admin HTML files
app.use('/admin', (req, res, next) => {
  const adminFile = req.path === '/' || req.path === '' ? 'index.html' : req.path.replace(/^\//, '');
  const adminPath = getUnifiedDashboardPath('admin', adminFile);
  
  if (require('fs').existsSync(adminPath) && adminPath.includes('unified-dashboard')) {
    return res.sendFile(adminPath);
  }
  
  next();
});
```

**Key Points:**
- `/admin` prefix serves files from `unified-dashboard/admin/`
- `index.html` is the default for `/admin`
- All admin pages are accessible ONLY from `/admin/page.html` (not from root `/page.html`)

## Best Practices

1. **Consistent Navigation:** Always use the unified sidebar component
2. **Relative Links:** Use relative paths (e.g., `index.html`, `leads.html`) for consistency
3. **Active State:** Let JavaScript handle active state highlighting (don't hardcode `active` class)
4. **URL Parameters:** Use `?tab=name` for direct linking to tabs in the main dashboard
5. **Terminology:** 
   - **Tenants** = Healthcare clinics (end users)
   - **Clients** = API customers (developers/companies)

## Common Issues & Solutions

### Issue: 404 errors for `/clients.html`, `/pipeline.html`, etc.
**Solution:** Use `/admin/clients.html`, `/admin/pipeline.html` instead. Admin pages are only accessible under `/admin/` prefix.

### Issue: Tab not activating when using URL parameter
**Solution:** Check that JavaScript reads `URLSearchParams` and calls `.click()` on the target tab button

### Issue: Sidebar active state not highlighting
**Solution:** Ensure JavaScript runs after DOM load and checks `window.location.pathname`

### Issue: Pipeline/Workflows tab causes error
**Solution:** These tabs redirect to standalone pages - ensure redirect happens before trying to access tab content

## Authentication

All admin pages require authentication via `ADMIN_PORTAL_SECRET`. The login flow:
1. Check for existing session cookie
2. If no session, show login form
3. On successful login, store session and show dashboard
4. All API calls include credentials for session validation

## Recent Updates

### Structure Consolidation
- **Pipeline tab** now redirects to `pipeline.html` (standalone has more features)
- **Workflows tab** redirects to `workflows.html` (visual builder needs full page)
- **Clients tab** and `clients.html` are kept (identical functionality, different access points)
- **Leads tab** and `leads.html` serve different purposes (dashboard view vs. full management)

### Navigation Improvements
- Unified sidebar across all pages
- Dynamic active state highlighting
- Breadcrumbs on standalone pages
- URL parameter support for direct tab linking

### Security & UX
- HTML escaping in client table to prevent XSS
- Proper error handling for missing tab content
- Consistent styling and theming
