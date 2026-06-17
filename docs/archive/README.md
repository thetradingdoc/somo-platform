# archive — consolidated documentation

**Single file:** All former `docs/archive/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Admin Portal Fixes - Complete Summary (`ADMIN_PORTAL_FIXES_COMPLETE.md`)](#admin-portal-fixes-complete)
- [Architecture Fixes Applied (`FIXES_APPLIED.md`)](#fixes-applied)
- [Archived Documentation (`README.md`)](#readme)
- [Tech Lead Cleanup Summary (`TECH_LEAD_CLEANUP.md`)](#tech-lead-cleanup)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="admin-portal-fixes-complete"></a>

## Admin Portal Fixes - Complete Summary

**Superseded (2026-06):** The tabbed admin dashboard described below was replaced by the 4-page operator CRM. See [`docs/admin-portal/README.md`](../admin-portal/README.md).

*Former path: `docs/archive/ADMIN_PORTAL_FIXES_COMPLETE.md`*


**Date:** 2025-12-13  
**Status:** ✅ All Critical Fixes Completed  
**Archived:** Historical reference; fixes completed.

## Overview

This document summarizes all fixes applied to the admin portal to resolve navigation, routing, and structural issues.

## Issues Fixed

### 1. Navigation & Routing ✅

**Problem:** Inconsistent navigation links, missing sidebars, 404 errors on direct URLs.

**Fixes:**
- ✅ Created unified sidebar navigation component across all pages
- ✅ Standardized all navigation links (relative paths)
- ✅ Added sidebar to all standalone pages (workflows, pipeline, leads, clients)
- ✅ Fixed server routing to serve pages from both `/admin/page.html` and `/page.html`
- ✅ Added breadcrumbs to standalone pages for context

### 2. Tab Structure ✅

**Problem:** Tab ID bug, inconsistent tab behavior, redirects not working.

**Fixes:**
- ✅ Fixed `id="tab-tenants"` → `id="tab-clients"` for Clients tab content
- ✅ Pipeline tab redirects to `pipeline.html` (standalone has more features)
- ✅ Workflows tab redirects to `workflows.html` (visual builder needs full page)
- ✅ Added URL parameter support (`/admin?tab=leads`) for direct tab linking
- ✅ Fixed tab switching logic to handle redirects without errors

### 3. Active State Highlighting ✅

**Problem:** Sidebar icons didn't show which page was active.

**Fixes:**
- ✅ Added JavaScript to dynamically detect current page
- ✅ Automatically applies `active` class to current page's icon
- ✅ Removed hardcoded `active` classes (now handled by JavaScript)
- ✅ Works for both tabs and standalone pages

### 4. Security ✅

**Problem:** Potential XSS vulnerabilities in client table.

**Fixes:**
- ✅ Added `escapeHtml()` function to prevent XSS
- ✅ Applied HTML escaping to client table data (name, email, type)
- ✅ Proper escaping in onclick handlers

### 5. Authentication Flow ✅

**Problem:** Email composer modal appeared before login.

**Fixes:**
- ✅ Changed modal initial CSS `display` to `none`
- ✅ Deferred email composer initialization until after login
- ✅ Only initializes on successful authentication

### 6. Terminology Clarification ✅

**Problem:** Confusion between "Tenants" and "Clients".

**Fixes:**
- ✅ Added tooltips to explain difference:
  - **Tenants** = Healthcare clinics (end users)
  - **Clients** = API customers (developers/companies)
- ✅ Updated tab descriptions
- ✅ Updated documentation

### 7. Structure Consolidation ✅

**Problem:** Duplicate functionality between tabs and standalone pages.

**Fixes:**
- ✅ Decided on hybrid structure:
  - Main dashboard with tabs for quick access
  - Standalone pages for complex features
- ✅ Pipeline and Workflows redirect to standalone pages
- ✅ Clients tab and `clients.html` kept (identical, different access points)
- ✅ Leads tab and `leads.html` serve different purposes

## Files Modified

### Frontend
- `unified-dashboard/admin/index.html` - Main dashboard with tabs
- `unified-dashboard/admin/workflows.html` - Workflow builder
- `unified-dashboard/admin/pipeline.html` - Sales pipeline
- `unified-dashboard/admin/leads.html` - Lead management
- `unified-dashboard/admin/clients.html` - Client management

### Backend
- `middleware-platform/server.js` - Routing configuration

### Documentation
- `docs/admin-portal/README.md` - Operator CRM (4-page portal; replaces tabbed dashboard)
- `docs/archive/README.md#admin-portal-fixes-complete` - This file (archived)

### Testing
- `middleware-platform/scripts/test-admin-routes.js` - Route testing script

## Testing Status

See [Admin Portal README](../admin-portal/README.md#admin-portal-testing) for the current testing guide.

## Related Documentation

- [Admin Portal README](../admin-portal/README.md) — 4-page operator CRM (supersedes tabbed dashboard from this archive)

---

**Status:** ✅ Ready for Testing


---

<a id="fixes-applied"></a>

## Architecture Fixes Applied

*Former path: `docs/archive/FIXES_APPLIED.md`*


**Date**: January 27, 2025  
**Status**: Phase 1 & 2 Complete - Ready for Local Testing  
**Archived:** Historical reference; applied fixes.

---

## ✅ Phase 1 Fixes Completed

### 1. **Created Constants File** ✅
- **File**: `middleware-platform/utils/constants.js`
- **Purpose**: Centralized configuration to avoid hardcoding
- **Changes**:
  - Added `TENANTS.DEFAULT_SUBDOMAIN` (configurable via env var)
  - Added `USDC.DECIMALS` and token IDs
  - Added other common constants

### 2. **Created Tenant Context Middleware** ✅
- **File**: `middleware-platform/middleware/tenant-context.js`
- **Purpose**: Extract and validate tenant from requests
- **Features**:
  - Extracts tenant from multiple sources (subdomain, phone, clinic_id, merchant_id)
  - Validates tenant exists and is active
  - Attaches `req.tenant` to all requests
  - Optional `requireTenant` mode (returns error if not found)
  - Backward compatible (doesn't break existing code)

### 3. **Removed Hardcoded Tenant References** ✅
- **Files Updated**:
  - `middleware-platform/routes/voice.js` (2 locations)
  - `middleware-platform/services/payment-orchestrator.js` (1 location)
  - `middleware-platform/server.js` (1 location)
  - `middleware-platform/routes/customer-agent.js` (1 location)
- **Changes**:
  - Replaced hardcoded `'akin-dunbar'` with `constants.TENANTS.DEFAULT_SUBDOMAIN`
  - Removed dangerous fallback logic
  - Return errors instead of guessing tenant

### 4. **Updated Payment Orchestrator** ✅
- **File**: `middleware-platform/services/payment-orchestrator.js`
- **Changes**:
  - Accepts optional `tenantContext` parameter
  - Uses tenant context for merchant resolution
  - Removed hardcoded fallback to `'akin-dunbar'`
  - Returns error if merchant cannot be determined

### 5. **Updated Voice Routes** ✅
- **File**: `middleware-platform/routes/voice.js`
- **Changes**:
  - Uses tenant context when available
  - Removed hardcoded fallback logic
  - Passes tenant context to PaymentOrchestrator
  - Returns clear error messages

### 6. **Updated Server.js** ✅
- **File**: `middleware-platform/server.js`
- **Changes**:
  - Removed hardcoded fallback in webhook handler
  - Returns error instead of guessing merchant

### 7. **Updated Customer Agent Routes** ✅
- **File**: `middleware-platform/routes/customer-agent.js`
- **Changes**:
  - Uses constants instead of hardcoded subdomain
  - Maintains backward compatibility

---

## ✅ Phase 2 Fixes Completed

### 8. **Fixed Retell WebSocket Handler** ✅
- **File**: `middleware-platform/webhooks/retell-websocket.js`
- **Changes**:
  - **Renamed `connection.customer_id` → `connection.clinic_id`** for clarity
  - Updated all tenant identification to use `clinic_id` consistently
  - Added comments explaining database schema limitations
  - Maintains backward compatibility (still works with legacy `customer_id` values)
  - Updated billing/credits to use `clinic_id` (mapped to `customer_id` for database)

**Key Improvements**:
- ✅ Clear naming: `clinic_id` instead of confusing `customer_id`
- ✅ Consistent tenant identification throughout
- ✅ Better logging (shows clinic_id in all logs)
- ✅ Legacy support (still accepts `customer_id` from old calls)

**Database Note**:
- The `voice_call_log` and `customer_credits` tables still use `customer_id` column
- For now, we use `clinic_id` as the value for `customer_id` (they're the same in practice)
- TODO: Future migration to add `clinic_id` column or create `clinic_credits` table

---

## 🔄 Backward Compatibility

**All changes are backward compatible:**
- ✅ Existing code continues to work
- ✅ Tenant context middleware is optional (doesn't break if not used)
- ✅ Constants file has sensible defaults
- ✅ Retell handler accepts both `clinic_id` and `customer_id` (legacy)
- ✅ No database schema changes required
- ✅ No breaking API changes

---

## 🧪 Testing Recommendations

See current deployment docs for testing. This file is archived for historical reference.

---

## 🔗 Related Files

- **Constants**: `middleware-platform/utils/constants.js`
- **Tenant Middleware**: `middleware-platform/middleware/tenant-context.js`
- **Architecture Issues**: `docs/architecture/README.md#maintenance-architecture-issues`
- **Onboarding Checklist**: `docs/onboarding/README.md#clinic-onboarding-checklist`

---

**Last Updated**: January 27, 2025  
**Status**: Archived


---

<a id="readme"></a>

## Archived Documentation

*Former path: `docs/archive/README.md`*

This folder contains archived documentation that is no longer actively maintained but kept for historical reference.

## Contents

### Historical fix summaries (archived 2026-03)
- **ADMIN_PORTAL_FIXES_COMPLETE.md** — Admin portal navigation, routing, security fixes (completed 2025-12)
- **FIXES_APPLIED.md** — Architecture Phase 1–2 fixes (constants, tenant context, Retell) (completed 2025-01)
- **TECH_LEAD_CLEANUP.md** — One-time doc consolidation: Video Consult + LangSmith merges (2026-02)

### `/azure-debug-scripts/`
Temporary debugging and analysis scripts from Azure deployment troubleshooting:
- Database analysis scripts
- Test verification scripts
- Debugging output files

**Note**: These are historical debugging artifacts. For current Azure documentation, see `../azure/README.md#readme`.

---

**Last Updated:** April 9, 2026



---

<a id="tech-lead-cleanup"></a>

## Tech Lead Cleanup Summary

*Former path: `docs/archive/TECH_LEAD_CLEANUP.md`*


**Date:** February 2026  
**Archived:** One-time consolidation record.

---

## Documentation changes

### Consolidated (replaced 3+ files with 1)

| Before | After |
|--------|--------|
| VIDEO_CONSULT_ARCHITECTURE.md, VIDEO_CONSULT_ENV.md, VIDEO_CONSULT_RUNBOOK.md | **VIDEO_CONSULT.md** (flow, env, runbook in one doc) |
| LANGGRAPH_LANGSMITH_DEVELOPER_GUIDE.md, LANGSMITH_TRACED_DATA_AND_PROGRESS.md | **LANGGRAPH_LANGSMITH.md** (config, what's traced, progress, scripts, troubleshooting) |

### Shortened / trimmed

| Doc | Change |
|-----|--------|
| **HYBRID_ARCHITECTURE_IMPROVEMENTS.md** | Replaced long plan with "Implemented" summary table + link to HYBRID_ARCHITECTURE_OVERVIEW |
| **DOCUMENTATION_SUMMARY.md** | Replaced long summary with short pointer to docs/README.md |

### Index updates

- **docs/architecture/README.md#readme** — Added Hybrid + VIDEO_CONSULT; kept layer index.
- **docs/README.md** — Added Hybrid Overview, Video Consult, LangGraph & LangSmith under Voice/Video/Coding.
- **livekit-agents/README.md**, **docs/architecture/README.md#media-media-layer-architecture**, **docs/testing/README.md#readme**, **docs/middleware-platform/README.md** — Links updated to consolidated docs.

---

## Tests and scripts

- **Tests removed** — All automated test files were removed per product decision.
- **Scripts** — Manual verification scripts kept; no deletion.

---

## Summary

- **Deleted:** 5 doc files (3 Video Consult, 2 LangSmith), replaced by 2 consolidated docs.
- **Updated:** 6 index/README files and 2 cross-references.


