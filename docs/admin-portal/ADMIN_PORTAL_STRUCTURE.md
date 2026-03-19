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

## File Locations

```
unified-dashboard/admin/
├── index.html          # Main dashboard with tabs
├── workflows.html      # Visual workflow builder
├── pipeline.html       # Sales pipeline
├── leads.html          # Lead management
└── clients.html        # Client management
```

## Related Documentation

- [ADMIN_PORTAL_FIXES_COMPLETE.md](../archive/ADMIN_PORTAL_FIXES_COMPLETE.md) (archived)
- [ADMIN_PORTAL_TESTING.md](./ADMIN_PORTAL_TESTING.md)
