# Admin Portal Testing Guide

**Last Updated:** 2025-12-13  
**Status:** ✅ Testing Script Created

## Overview

This document outlines how to test the admin portal to ensure all navigation, routing, and functionality works correctly.

## Automated Testing

### Route Testing Script

A Node.js script is available to test all admin portal routes:

```bash
# Test against local server
node middleware-platform/scripts/test-admin-routes.js http://localhost:4000

# Test against production (if accessible)
node middleware-platform/scripts/test-admin-routes.js https://doclittle.site
```

**What it tests:**
- Main dashboard access (`/admin`, `/admin/index.html`)
- Tab URL parameters (`/admin?tab=leads`, `/admin?tab=clients`, etc.)
- Standalone pages with `/admin/` prefix
- Standalone pages with direct access (root URLs)
- HTTP status codes (expects 200 for all)

**Expected Output:**
```
🧪 Testing Admin Portal Routes

Base URL: http://localhost:4000

──────────────────────────────────────────────────────────────────────
Testing: Main Dashboard                        ... ✅ PASS
Testing: Dashboard (index.html)                ... ✅ PASS
Testing: Dashboard (leads tab)                 ... ✅ PASS
...
📊 Summary: 14/14 passed, 0 failed
```

## Manual Testing Checklist

### 1. Navigation Links

Test navigation from each page:

#### From Main Dashboard (`/admin`)
- [ ] Click "Dashboard" tab → Shows dashboard content
- [ ] Click "Tenants" tab → Shows tenants/clinics list
- [ ] Click "Leads" tab → Shows leads search interface
- [ ] Click "Pipeline" tab → Redirects to `pipeline.html`
- [ ] Click "Clients" tab → Shows clients/credits table
- [ ] Click "⚡ Workflows" tab → Redirects to `workflows.html`
- [ ] Click sidebar icons → Navigate to corresponding pages

#### From Workflows, Pipeline, Leads, Clients pages
- [ ] Sidebar navigation works
- [ ] Breadcrumbs show correct context

### 2. Tab Functionality

Test tabs in main dashboard (`/admin`):

- [ ] **Dashboard Tab** - Loads, shows stats, activity feed, AI Assistant
- [ ] **Tenants Tab** - Shows clinics, credit allocation, tooltips
- [ ] **Leads Tab** - Search interface, sub-tabs, lead data
- [ ] **Pipeline Tab** - Redirects to `pipeline.html`
- [ ] **Clients Tab** - Clients table, credits, tooltips, XSS escaping
- [ ] **Workflows Tab** - Redirects to `workflows.html`

### 3. URL Parameter Support

- [ ] `/admin?tab=dashboard` → Opens dashboard tab
- [ ] `/admin?tab=tenants` → Opens tenants tab
- [ ] `/admin?tab=leads` → Opens leads tab
- [ ] `/admin?tab=clients` → Opens clients tab
- [ ] Invalid tab parameter → Falls back to dashboard

### 4. Direct URL Access

With `/admin/` prefix:
- [ ] `/admin`, `/admin/index.html` → Main dashboard
- [ ] `/admin/workflows.html`, `/admin/pipeline.html`, `/admin/leads.html`, `/admin/clients.html` → Respective pages

Root-level access (should be blocked):
- [ ] `/workflows.html`, `/pipeline.html`, etc. → 404

### 5. Active State Highlighting

- [ ] Sidebar icon highlights for current page/tab

### 6. Authentication

- [ ] Login form shows when unauthenticated
- [ ] Valid credentials → Dashboard
- [ ] Session persists, logout works

### 7. Security

- [ ] HTML escaping in client table (XSS prevention)

## Related Documentation

- [ADMIN_PORTAL_STRUCTURE.md](./ADMIN_PORTAL_STRUCTURE.md)
- [ADMIN_PORTAL_FIXES_COMPLETE.md](../archive/ADMIN_PORTAL_FIXES_COMPLETE.md) (archived)
