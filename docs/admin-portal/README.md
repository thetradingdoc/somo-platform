# admin portal — consolidated documentation

**Single file:** All former `docs/admin-portal/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Admin Portal Structure (`ADMIN_PORTAL_STRUCTURE.md`)](#admin-portal-structure)
- [Admin Portal Testing Guide (`ADMIN_PORTAL_TESTING.md`)](#admin-portal-testing)
- [Admin Portal Documentation (`README.md`)](#readme)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="admin-portal-structure"></a>

## Admin Portal Structure

*Former path: `docs/admin-portal/ADMIN_PORTAL_STRUCTURE.md`*


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

- [ADMIN_PORTAL_FIXES_COMPLETE.md](../archive/README.md#admin-portal-fixes-complete) (archived)
- [ADMIN_PORTAL_TESTING.md](./README.md#admin-portal-testing)


---

<a id="admin-portal-testing"></a>

## Admin Portal Testing Guide

*Former path: `docs/admin-portal/ADMIN_PORTAL_TESTING.md`*


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
node middleware-platform/scripts/test-admin-routes.js https://api.callsomo.com
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

- [ADMIN_PORTAL_STRUCTURE.md](./README.md#admin-portal-structure)
- [ADMIN_PORTAL_FIXES_COMPLETE.md](../archive/README.md#admin-portal-fixes-complete) (archived)


---

<a id="readme"></a>

## Admin Portal Documentation

*Former path: `docs/admin-portal/README.md`*

**Last Updated:** April 9, 2026

Documentation for the Somo admin portal (unified dashboard admin section).

## Documents

- **[ADMIN_PORTAL_STRUCTURE.md](./README.md#admin-portal-structure)** - Structure, URL patterns, navigation
- **[ADMIN_PORTAL_TESTING.md](./README.md#admin-portal-testing)** - Testing guide and checklist
- **[ADMIN_PORTAL_FIXES_COMPLETE.md](../archive/README.md#admin-portal-fixes-complete)** - Summary of fixes applied (archived)

## Quick Reference

- **Main Dashboard**: `/admin` or `/admin/index.html`
- **Standalone Pages**: `/admin/workflows.html`, `/admin/pipeline.html`, `/admin/leads.html`, `/admin/clients.html`
- **Route Test**: `node middleware-platform/scripts/test-admin-routes.js http://localhost:4000`


