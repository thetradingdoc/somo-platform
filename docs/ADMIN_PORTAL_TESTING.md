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
Testing: Dashboard (clients tab)                ... ✅ PASS
Testing: Dashboard (tenants tab)               ... ✅ PASS
Testing: Workflows (admin prefix)              ... ✅ PASS
Testing: Pipeline (admin prefix)                ... ✅ PASS
Testing: Leads (admin prefix)                  ... ✅ PASS
Testing: Clients (admin prefix)                ... ✅ PASS
Testing: Workflows (direct)                    ... ✅ PASS
Testing: Pipeline (direct)                     ... ✅ PASS
Testing: Leads (direct)                        ... ✅ PASS
Testing: Clients (direct)                      ... ✅ PASS

──────────────────────────────────────────────────────────────────────

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

#### From Workflows Page (`/admin/workflows.html`)
- [ ] Click "Dashboard" icon → Goes to `/admin`
- [ ] Click "Leads" icon → Goes to `/admin?tab=leads` or `leads.html`
- [ ] Click "Pipeline" icon → Goes to `pipeline.html`
- [ ] Click "Clients" icon → Goes to `/admin?tab=clients` or `clients.html`
- [ ] Breadcrumb shows "Admin > Workflows"

#### From Pipeline Page (`/admin/pipeline.html`)
- [ ] Click "Dashboard" icon → Goes to `/admin`
- [ ] Click "Leads" icon → Goes to `/admin?tab=leads` or `leads.html`
- [ ] Click "Workflows" icon → Goes to `workflows.html`
- [ ] Click "Clients" icon → Goes to `/admin?tab=clients` or `clients.html`
- [ ] Breadcrumb shows "Admin > Pipeline"

#### From Leads Page (`/admin/leads.html`)
- [ ] Click "Dashboard" icon → Goes to `/admin`
- [ ] Click "Pipeline" icon → Goes to `pipeline.html`
- [ ] Click "Workflows" icon → Goes to `workflows.html`
- [ ] Click "Clients" icon → Goes to `/admin?tab=clients` or `clients.html`
- [ ] Breadcrumb shows "Admin > Leads"

#### From Clients Page (`/admin/clients.html`)
- [ ] Click "Dashboard" icon → Goes to `/admin`
- [ ] Click "Leads" icon → Goes to `/admin?tab=leads` or `leads.html`
- [ ] Click "Pipeline" icon → Goes to `pipeline.html`
- [ ] Click "Workflows" icon → Goes to `workflows.html`
- [ ] Breadcrumb shows "Admin > Clients"

### 2. Tab Functionality

Test tabs in main dashboard (`/admin`):

- [ ] **Dashboard Tab**
  - [ ] Loads on initial page load
  - [ ] Shows stats (tenants, leads, clients, etc.)
  - [ ] Shows activity feed
  - [ ] AI Assistant sidebar is accessible

- [ ] **Tenants Tab**
  - [ ] Shows list of healthcare clinics
  - [ ] Displays clinic information correctly
  - [ ] Credit allocation modal works
  - [ ] Tooltip explains "Healthcare clinics using the platform"

- [ ] **Leads Tab**
  - [ ] Shows lead search interface
  - [ ] Sub-tabs work (Search, Intelligence, etc.)
  - [ ] Lead data loads correctly
  - [ ] Actions (email, call, etc.) work

- [ ] **Pipeline Tab**
  - [ ] Redirects to `pipeline.html` (doesn't show tab content)
  - [ ] No JavaScript errors in console

- [ ] **Clients Tab**
  - [ ] Shows clients/credits table
  - [ ] Displays customer information correctly
  - [ ] Credit allocation works
  - [ ] Tooltip explains "API customers (developers/companies)"
  - [ ] HTML escaping works (no XSS vulnerabilities)

- [ ] **Workflows Tab**
  - [ ] Redirects to `workflows.html` (doesn't show tab content)
  - [ ] No JavaScript errors in console

### 3. URL Parameter Support

Test direct tab linking:

- [ ] `/admin?tab=dashboard` → Opens dashboard tab
- [ ] `/admin?tab=tenants` → Opens tenants tab
- [ ] `/admin?tab=leads` → Opens leads tab
- [ ] `/admin?tab=clients` → Opens clients tab
- [ ] `/admin?tab=pipeline` → Redirects to `pipeline.html`
- [ ] `/admin?tab=workflows` → Redirects to `workflows.html`
- [ ] Invalid tab parameter → Falls back to dashboard

### 4. Direct URL Access

Test accessing pages directly:

#### With `/admin/` prefix:
- [ ] `/admin` → Main dashboard
- [ ] `/admin/index.html` → Main dashboard
- [ ] `/admin/workflows.html` → Workflows page
- [ ] `/admin/pipeline.html` → Pipeline page
- [ ] `/admin/leads.html` → Leads page
- [ ] `/admin/clients.html` → Clients page

#### Root-level access (should be blocked):
- [ ] `/workflows.html` → Should return 404 (admin pages only under /admin/)
- [ ] `/pipeline.html` → Should return 404
- [ ] `/leads.html` → Should return 404
- [ ] `/clients.html` → Should return 404

### 5. Active State Highlighting

Test sidebar active state:

- [ ] On `/admin` → Dashboard icon is highlighted
- [ ] On `/admin?tab=leads` → Leads icon is highlighted
- [ ] On `/admin?tab=clients` → Clients icon is highlighted
- [ ] On `/admin/workflows.html` → Workflows icon is highlighted
- [ ] On `/admin/pipeline.html` → Pipeline icon is highlighted
- [ ] On `/admin/leads.html` → Leads icon is highlighted
- [ ] On `/admin/clients.html` → Clients icon is highlighted

### 6. Authentication

Test login flow:

- [ ] Accessing `/admin` without session → Shows login form
- [ ] Invalid credentials → Shows error message
- [ ] Valid credentials → Redirects to dashboard
- [ ] Session persists across page refreshes
- [ ] Logout button works
- [ ] After logout, accessing admin pages → Shows login form

### 7. Error Handling

Test error scenarios:

- [ ] Invalid tab ID → No JavaScript errors, falls back gracefully
- [ ] Missing tab content → No errors, tab just doesn't activate
- [ ] Network errors → Error messages displayed appropriately
- [ ] 404 on non-existent page → Proper error response

### 8. Browser Compatibility

Test in different browsers:

- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browsers (iOS Safari, Chrome Mobile)

### 9. Console Errors

Check browser console for errors:

- [ ] No JavaScript errors on page load
- [ ] No 404 errors for missing resources
- [ ] No CORS errors
- [ ] No authentication errors (unless expected)

### 10. Security

Test security features:

- [ ] HTML escaping in client table (try entering `<script>` tags)
- [ ] XSS prevention in user-generated content
- [ ] Session cookies are HttpOnly and Secure (in production)
- [ ] API endpoints require authentication

## Common Issues & Solutions

### Issue: Tab not switching
**Check:**
- Browser console for JavaScript errors
- Tab has `data-tab` attribute
- Tab content div exists with `id="tab-{name}"`
- Event listeners are attached

### Issue: Active state not highlighting
**Check:**
- JavaScript runs after DOM load
- `window.location.pathname` is correct
- Sidebar icon has correct onclick handler

### Issue: 404 on direct URL
**Check:**
- Server has route configured in `server.js`
- File exists in `unified-dashboard/admin/`
- Route is before catch-all 404 handler

### Issue: Redirect loop
**Check:**
- Pipeline/Workflows tabs redirect before accessing tab content
- No infinite redirect in authentication flow

## Testing Results Template

```
Date: [Date]
Tester: [Name]
Environment: [Local/Staging/Production]
Server URL: [URL]

✅ Passed: [List]
❌ Failed: [List]
⚠️  Warnings: [List]

Notes:
[Any additional observations]
```

## Next Steps

After completing manual testing:
1. Document any issues found
2. Create bug reports for critical issues
3. Update this guide with new test cases
4. Consider adding automated E2E tests (Playwright, Cypress, etc.)

