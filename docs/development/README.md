# development - Unified Architecture and System Design
> Last reviewed: 2026-05-21

**Last Updated:** 2026-05-30


**Canonical map:** [CANONICAL_DOC_MAP.md](../meta/CANONICAL_DOC_MAP.md) — read here first to avoid duplicating documentation.

## Existing Documentation Body

This document is the single source of truth for this subfolder. It consolidates architecture, system design, operational behavior, and implementation notes previously split across multiple markdown files.


## Scope


- Folder: `development`
- Consolidated on: 2026-04-29



## Existing README Content


# development — consolidated documentation


## Table of contents

- [Code Review and Cleanup Summary (`code-reviews/CODE_REVIEW_AND_CLEANUP.md`)](#code-reviews-code-review-and-cleanup)
- [Documentation Summary (`DOCUMENTATION_SUMMARY.md`)](#documentation-summary)
- [GitHub Tasks (`GITHUB_TASKS.md`)](#github-tasks)
- [Code Structure Review (`guides/CODE_STRUCTURE.md`)](#guides-code-structure)
- [API Reliability & Crash Prevention (`guides/RELIABILITY.md`)](#guides-reliability)
- [Codebase Improvement Plan (`IMPROVEMENT_PLAN.md`)](#improvement-plan)
- [Invoice Billing System - Implementation Summary (`invoice-billing/IMPLEMENTATION_SUMMARY.md`)](#invoice-billing-implementation-summary)
- [Voice / commerce LLM (`KELLY_*`) — environment and debugging (`KELLY_ENV_AND_DEBUG.md`)](#kelly-env-and-debug)
- [Platform — full backlog (`MASTER_TODO_FULL.md`)](#master-todo-full)
- [Periodic maintenance (quarterly suggested) (`PERIODIC_MAINTENANCE.md`)](#periodic-maintenance)
- [`server.js` — incremental refactor policy (`SERVER_JS_REFACTOR_POLICY.md`)](#server-js-refactor-policy)
- [Structured logging (future) (`STRUCTURED_LOGGING_FUTURE.md`)](#structured-logging-future)
- [Automation Template Variables (`templates.md`)](#templates)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="code-reviews-code-review-and-cleanup"></a>

## Code Review and Cleanup Summary


## Date: December 2024

## Code Review Findings

### Issues Fixed

1. **Invoice Service - Variable Reference Bug**
   - **File**: `middleware-platform/services/invoice-service.js`
   - **Issue**: Used `invoice.amount` before invoice object was fully created
   - **Fix**: Extracted `invoiceAmount` variable before creating invoice object
   - **Line**: ~80

2. **Invoice Service - Patient Name Extraction**
   - **File**: `middleware-platform/services/invoice-service.js`
   - **Issue**: Incorrect patient name extraction from FHIR resource
   - **Fix**: Added proper FHIR name parsing logic
   - **Line**: ~211

3. **Invoice Service - Database Function Name**
   - **File**: `middleware-platform/services/invoice-service.js`
   - **Issue**: Used `getClaimById` which exists but `getInsuranceClaim` is more standard
   - **Fix**: Changed to use `getInsuranceClaim` for consistency
   - **Line**: ~17

### Code Quality Checks

✅ **Linter Errors**: None found
✅ **TODO Comments**: None found
✅ **FIXME Comments**: None found
✅ **Error Handling**: All endpoints have proper error handling
✅ **Input Validation**: All endpoints validate required fields
✅ **Rate Limiting**: All API endpoints have rate limiting

### Database Functions Verified

All required database functions exist and are properly implemented:
- ✅ `createInvoice`
- ✅ `getInvoice`
- ✅ `getInvoices` (with filters)
- ✅ `updateInvoice`
- ✅ `addInvoiceItem`
- ✅ `getInvoiceItems`
- ✅ `addInvoicePayment`
- ✅ `getInvoicePayments`
- ✅ `getInvoicePaymentsTotal`
- ✅ `generateInvoiceNumber`
- ✅ `getInsuranceClaim`
- ✅ `getInvoicesByClaim`

## Test Files Cleanup

### Test Files to Keep

The following test files are kept as they serve specific purposes:

**Core Tests:**
- `test-retell-functions.js` - Tests Retell AI integration
- `test-voice-agent-flow.js` - Tests voice agent functionality
- `test-stripe-issuing-quick.js` - Tests Stripe Issuing
- `test-stripe-issuing-full.js` - Comprehensive Stripe tests
- `test-uhc-fhir.js` - Tests UHC FHIR integration
- `test-stedi-patient-sync.js` - Tests Stedi patient sync
- `test-epic-integration.js` - Tests Epic EHR integration
- `test-ehr-integration.js` - Tests EHR integration
- `test-wallet-payment.js` - Tests wallet payment functionality
- `test-tenant-isolation.js` - Tests multi-tenant isolation
- `test-clinic-signup.js` - Tests clinic signup flow
- `test-postgres-routing.js` - Tests Postgres routing

**Email Tests:**
- `test-email-flow.js` - Tests email sending flow
- `test-appointment-email.js` - Tests appointment emails
- `test-email-booking-api.js` - Tests booking email API

**Utility Tests:**
- `test-geocoding-service.js` - Tests geocoding
- `test-location-verification.js` - Tests location verification
- `test-delivery-confirmation.js` - Tests delivery confirmation
- `test-medical-coding.js` - Tests medical coding extraction
- `test-medical-coding-buckets.js` - Tests coding buckets
- `test-groq-connection.js` - Tests Groq AI connection
- `test-patient-id-uniqueness.js` - Tests patient ID uniqueness
- `test-patient-selection-fix.js` - Tests patient selection

**Comprehensive Tests:**
- `test-all.js` - Runs all tests
- `test-all-features.js` - Tests all features
- `test-comprehensive-system.js` - Comprehensive system test
- `test-e2e-complete-flow.js` - End-to-end test
- `test-all-retell-functions.js` - All Retell function tests
- `test-retell-functions.complex.js` - Complex Retell tests

**Debug Tests:**
- `test-email-debug.js` - Email debugging
- `test-email-comprehensive.js` - Comprehensive email tests

### Test Files Structure

All test files are organized in `middleware-platform/tests/` directory with a `README.md` explaining how to run them.

## Scripts Cleanup

### Scripts to Keep

All scripts in `middleware-platform/scripts/` are kept as they serve operational purposes:
- Database backup/restore
- Patient management
- Wallet configuration
- Circle payment setup
- Email configuration
- Testing utilities
- Monitoring tools

## Documentation Created

1. **API Documentation**: `docs/api/README.md#invoice-api`
   - Complete API reference for invoice endpoints
   - Request/response examples
   - Error handling

2. **User Guide**: `docs/user-guides/INVOICE_WORKFLOW.md`
   - Step-by-step workflow guide
   - Best practices
   - Troubleshooting

3. **Implementation Summary**: `docs/development/README.md#invoice-billing-implementation-summary`
   - Complete implementation overview
   - Architecture details
   - File changes
   - Deployment notes

4. **Code Review**: `docs/development/README.md#code-reviews-code-review-and-cleanup` (this file)
   - Issues found and fixed
   - Code quality checks
   - Cleanup decisions

## Files Modified Summary

### New Files Created (9)
1. `middleware-platform/services/invoice-service.js`
2. `middleware-platform/services/pdf-invoice-service.js`
3. `middleware-platform/routes/invoices-clinic.js`
4. `unified-dashboard/business/invoice-detail.html`
5. `unified-dashboard/business/medical-billing.html`
6. `unified-dashboard/business/commerce-billing.html`
7. `docs/api/README.md#invoice-api`
8. `docs/user-guides/INVOICE_WORKFLOW.md`
9. `docs/development/README.md#invoice-billing-implementation-summary`

### Files Modified (8)
1. `middleware-platform/database.js` - Added invoice tables and functions
2. `middleware-platform/server.js` - Added invoice routes
3. `middleware-platform/services/email-service.js` - Added attachment support
4. `middleware-platform/routes/tenant-config.js` - Updated navigation
5. `unified-dashboard/business/invoices.html` - Complete rewrite
6. `unified-dashboard/business/claims.html` - Added Generate Invoice button
7. `unified-dashboard/business/pdf-coding.html` - Added invoice prompt
8. `unified-dashboard/business/billing.html` - Added tenant routing

## Code Quality Metrics

- **Total Lines of Code Added**: ~2,500
- **Functions Created**: 15+
- **API Endpoints**: 7
- **Database Tables**: 3
- **Database Functions**: 12
- **Frontend Pages**: 3 new, 4 modified
- **Linter Errors**: 0
- **Test Coverage**: Manual testing required

## Deployment Checklist

- [x] Database migrations auto-created
- [x] No breaking changes to existing APIs
- [x] Backward compatible with existing data
- [x] Error handling on all endpoints
- [x] Rate limiting configured
- [x] Documentation complete
- [ ] PDFKit installation (optional)
- [ ] Manual testing of invoice flow
- [ ] Email configuration verified

## Next Steps

1. **Install PDFKit** (optional):
   ```bash
   cd middleware-platform
   npm install pdfkit
   ```

2. **Test Invoice Flow**:
   - Upload PDF
   - Create claim
   - Generate invoice
   - Send email
   - Record payment

3. **Monitor Logs**:
   - Check for any errors in invoice generation
   - Verify email sending works
   - Monitor payment recording

## Support

For issues:
- Check API docs: `docs/api/README.md#invoice-api`
- Check user guide: `docs/user-guides/INVOICE_WORKFLOW.md`
- Review server logs
- Check browser console



---

<a id="documentation-summary"></a>

## Documentation Summary



High-level index of platform docs. **Full navigation and structure:** [docs/README.md](../README.md#readme).

**Essential:** [Setup](../setup/README.md#getting-started-setup) · [Deployment](../deployment/README.md#guides-deployment-guide) · [API](../api/README.md#api-documentation) · [Architecture](../architecture/README.md#readme) · [Voice & Video](../architecture/README.md#overview-hybrid-architecture-overview) · [Landing Try now / LiveKit](../architecture/README.md#experience-landing-try-now-livekit).

**By audience:** Developers → architecture, API, code structure. DevOps → deployment, security, DB. Product → vision, user guides, onboarding.


---

<a id="github-tasks"></a>

## GitHub Tasks



Tasks to improve repo structure, hygiene, and maintainability based on branch and structure review.

---

## P1 — Immediate

- [x] **Merge feature branch into main**  
  ✅ Done (March 2026). `feature/layer2-rag-perceptual-state` merged into `main`.

- [x] **Delete merged feature branch**  
  ✅ Done. Removed `feature/knowledge-base-improvements-and-bug-fixes` from remote.
  ```bash
  git push origin --delete feature/knowledge-base-improvements-and-bug-fixes
  ```

---

## P2 — Repository structure

- [ ] **Fix medical-rag-api embedded repo**  
  `medical-rag-api` is committed as gitlink; clones see empty directory. Choose one:
  - Convert to submodule: `git submodule add <repo-url> medical-rag-api`
  - Or remove from tracking and add to `.gitignore`; document setup in README

- [ ] **Optimize Knowledge/ large files**  
  Large binaries in `Knowledge/` (e.g. ~100MB+) bloat clones. Options:
  - Add Git LFS for `Knowledge/**` (`.gitattributes` + `git lfs track`)
  - Or move to external storage / data repo; document fetch in README

- [x] **Add .gitignore for medical-rag-api (if not submodule)**  
  ✅ Done. Added `medical-rag-api/` to .gitignore and removed from tracking.
  ```
  medical-rag-api/
  ```

---

## P3 — Documentation

- [ ] **Consolidate architecture docs**  
  Reduce overlap among:
  - `ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`
  - `HYBRID_ARCHITECTURE_OVERVIEW.md`
  - `HYBRID_ARCHITECTURE_IMPROVEMENTS.md`  
  Merge or cross-link and clarify scope of each.

- [ ] **Add services overview**  
  Document payment services in `middleware-platform/services/README.md`:
  - `payment-service.js`, `payment-processor-service.js`, `payment-orchestrator.js`
  - `payment-method-config.js`, `payment-rails-service.js`, `payment-security.js`  
  Include roles and call flow.

---

## P4 — Ongoing hygiene

- [ ] **Branch naming convention**  
  Decide and document: e.g. `feature/*`, `fix/*`, `docs/*` and when to delete branches.

- [ ] **PR template**  
  Add `.github/PULL_REQUEST_TEMPLATE.md` for checklist (tests, docs, breaking changes).

- [ ] **Protected branches**  
  Consider protecting `main` (require PR, status checks, no force-push) if not already set.

---

## Quick reference

| Branch | Status |
|--------|--------|
| `main` | Default; `da298f4` |
| `feature/layer2-rag-perceptual-state` | 5 commits ahead; ready to merge |
| `feature/knowledge-base-improvements-and-bug-fixes` | Merged; safe to delete |

---

*Generated from branch and structure review. Update as tasks are completed.*


---

<a id="guides-code-structure"></a>

## Code Structure Review


This document outlines the code structure and organization of the **somo** monorepo (product: **Somo** — see [`docs/Brand/SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md)).

## 📁 Project Structure

```
somo/
├── middleware-platform/          # Backend API service
│   ├── server.js                  # Main Express server entry point
│   ├── database.js                # Database schema and migrations
│   ├── adapters/                 # External API adapters
│   │   ├── fhir-adapter.js
│   │   ├── voice-adapter.js
│   │   └── ...
│   ├── middleware/                # Express middleware
│   │   ├── auth.js
│   │   ├── rate-limiter.js
│   │   ├── security.js
│   │   └── ...
│   ├── models/                    # Data models
│   │   ├── payment-orchestrator.js
│   │   └── ...
│   ├── routes/                    # API route handlers
│   │   ├── voice.js
│   │   ├── admin.js
│   │   ├── payment.js
│   │   └── ...
│   ├── services/                  # Business logic services
│   │   ├── booking-service.js
│   │   ├── insurance-service.js
│   │   ├── payment-orchestrator.js
│   │   └── ...
│   ├── scripts/                   # Utility scripts
│   │   ├── setup-circle-wallets.js
│   │   ├── backup-database.js
│   │   └── ...
│   ├── __tests__/                 # Jest tests (see jest.config.js; may be sparse)
│   ├── utils/                     # Utility functions
│   │   ├── api-keys.js
│   │   ├── postgres.js
│   │   └── ...
│   └── webhooks/                  # Webhook handlers
│       └── retell-websocket.js
│
├── unified-dashboard/             # Frontend static files
│   ├── business/                  # Provider dashboard pages
│   ├── patients/                  # Patient portal pages
│   ├── admin/                     # Admin pages
│   └── assets/                    # CSS, JS, images
│
├── docs/                          # All documentation (organized)
│   ├── api/                       # API documentation
│   ├── architecture/              # Architecture docs
│   ├── deployment/                # Deployment guides
│   ├── middleware-platform/       # Platform-specific docs
│   ├── reports/                   # Historical reports
│   └── ...
│
├── scripts/                       # Root-level utility scripts
│   ├── deploy-to-azure.sh
│   └── ...
│
└── Knowledge/                     # Reference data
    ├── CPT/                       # CPT codes
    ├── documents/                 # Sample data
    └── ...
```

## ✅ Code Organization Best Practices

### 1. Separation of Concerns
- **Routes** (`routes/`) - Handle HTTP requests/responses
- **Services** (`services/`) - Business logic
- **Adapters** (`adapters/`) - External API integrations
- **Middleware** (`middleware/`) - Cross-cutting concerns (auth, rate limiting, etc.)
- **Models** (`models/`) - Data models and orchestrators
- **Utils** (`utils/`) - Reusable utility functions

### 2. Documentation Organization
- All documentation is centralized in `docs/`
- Platform-specific docs in `docs/middleware-platform/`
- API design docs in `docs/api/design/`
- Historical reports in `docs/reports/`
- No scattered `.md` files in code directories

### 3. Configuration Management
- Environment variables for all configuration
- Database connection handled in `database.js`
- Service initialization with graceful fallbacks
- Optional dependencies handled gracefully

### 4. Error Handling
- Centralized error handling middleware
- Structured error responses
- Logging for debugging
- Graceful degradation for optional services

## New code guidelines

- Prefer adding **Express routes** under `middleware-platform/routes/` and **mounting** them from `server.js` instead of growing inline handlers in `server.js` (~11k lines compose entry; see [`SERVER_DECOMPOSITION.md`](../architecture/SERVER_DECOMPOSITION.md)).
- **Jest** uses `middleware-platform/__tests__/` (see `jest.config.js`). The npm script runs `jest --passWithNoTests` until more tests land.
- **Integration / manual scripts** may still live as `middleware-platform/test-*.js` or under `scripts/`; migrating those into `__tests__/` is incremental cleanup.
- **Module boundaries (soft rule):** `routes/` → `services/` → `adapters/` / `database`; avoid `services/` importing Express `req`/`res`. Keeps units testable without booting HTTP.

## 🔧 Areas for Improvement

### 1. Test file organization
**Current:** Jest roots at `__tests__/`; many legacy `test-*.js` files may still exist at the middleware root for manual runs.  
**Recommendation:** Add real unit/integration tests under `__tests__/` and retire ad-hoc files over time.

### 2. Script Organization
**Current**: All scripts in `scripts/` directory  
**Status**: ✅ Well organized

**Considerations**:
- Scripts are well-named and descriptive
- Could be further organized by category (setup, testing, maintenance)
- Current organization is acceptable

### 3. Service Dependencies
**Current**: Services are imported in `server.js`  
**Status**: ✅ Good separation

**Considerations**:
- Services are properly modularized
- Optional dependencies handled gracefully
- Could benefit from dependency injection for better testability

### 4. Database Access
**Current**: Direct database access in services  
**Status**: ✅ Functional

**Considerations**:
- Database abstraction layer could improve testability
- Current approach is pragmatic and works well
- Postgres/SQLite dual support is well-handled

## 📋 Code Quality Checklist

### ✅ Implemented
- [x] Clear separation of routes, services, and adapters
- [x] Centralized error handling
- [x] Environment-based configuration
- [x] Graceful handling of optional dependencies
- [x] Structured logging
- [x] Security middleware (rate limiting, input sanitization)
- [x] Database migrations
- [x] Documentation organization

### 🔄 Recommended Improvements
- [ ] Move test files to `tests/` directory
- [ ] Add dependency injection for services
- [ ] Consider adding a database abstraction layer
- [ ] Add more comprehensive unit tests
- [ ] Consider TypeScript for better type safety
- [ ] Add API versioning strategy
- [ ] Implement request/response validation schemas

## 🎯 Architecture Principles

### 1. Modularity
Each service is self-contained and can be tested independently.

### 2. Extensibility
New features can be added by:
- Adding new routes in `routes/`
- Creating new services in `services/`
- Adding adapters in `adapters/`

### 3. Maintainability
- Clear file organization
- Consistent naming conventions
- Comprehensive documentation
- Centralized configuration

### 4. Scalability
- Stateless API design
- Database connection pooling
- Rate limiting
- Caching strategies

## 📚 Related Documentation

- API Documentation (`./api/README.md#api-documentation`)
- Architecture Overview (`./architecture/README.md#readme`)
- Deployment Guide (`./deployment/README.md#readme`)
- Testing Guide (`./testing/README.md#readme`)

---

**Last Updated**: November 2024  
**Review Status**: ✅ Code structure is well-organized with minor improvements recommended



---

<a id="guides-reliability"></a>

## API Reliability & Crash Prevention


## Overview
This document outlines the comprehensive reliability measures implemented to ensure the API runs continuously without crashes, protecting businesses that depend on it.

## Protective Measures

### 1. Error Handling & Crash Prevention

#### Comprehensive Error Handler (`middleware/error-handler.js`)
- **Graceful Error Handling**: All errors are caught and handled without crashing
- **Error Rate Monitoring**: Circuit breaker pattern prevents cascading failures
- **Error Logging**: All errors logged to database and console
- **Timeout Protection**: Operations timeout after 30s to prevent hanging
- **Retry Logic**: Exponential backoff for transient failures
- **Memory Monitoring**: Automatic garbage collection and memory leak detection

#### Key Features:
```javascript
// Wraps async routes to catch errors
asyncHandler(routeHandler)

// Adds timeout protection
withTimeout(operation, 30000)

// Retries with exponential backoff
withRetry(operation, 3, 1000)
```

### 2. Process Management

#### PM2 Configuration (`ecosystem.config.js`)
- **Auto-restart**: Automatically restarts on crash
- **Memory limits**: Restarts if memory exceeds 800MB
- **Max restarts**: Limits restart attempts (10 per minute)
- **Graceful shutdown**: Waits for connections to close
- **Health checks**: Monitors app health

#### Usage:
```bash
# Start with PM2
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# View logs
pm2 logs doclittle-api
```

### 3. Health Monitoring

#### Health Check Endpoints (`middleware/health-check.js`)
- **`/health`**: Quick health status
- **`/health?detailed=true`**: Comprehensive health metrics
- **`/health/ready`**: Readiness probe (for Kubernetes/Azure)
- **`/health/live`**: Liveness probe

#### Monitored Metrics:
- Database connectivity & response time
- Memory usage (heap, RSS)
- Disk usage
- Uptime
- Error rates

### 4. Azure App Service Reliability

#### Automatic Features:
- **Auto-restart**: Azure restarts app on failure
- **Health probes**: Azure monitors `/health` endpoint
- **Load balancing**: Distributes traffic across instances
- **Scaling**: Auto-scale based on load
- **Deployment slots**: Zero-downtime deployments

#### Configuration:
```bash
# Set health check path
az webapp config set --name doclittle --resource-group doclittle \
  --generic-configurations '{"healthCheckPath": "/health"}'

# Enable always on
az webapp config set --name doclittle --resource-group doclittle \
  --always-on true
```

### 5. Database Resilience

#### Connection Handling:
- **Connection pooling**: Better-sqlite3 handles connections efficiently
- **Error recovery**: Database errors don't crash the app
- **Retry logic**: Automatic retries for transient DB errors
- **Migration safety**: Schema migrations run safely on startup

### 6. Graceful Shutdown

#### Implementation:
- **SIGINT/SIGTERM handling**: Graceful shutdown on termination
- **Connection cleanup**: Closes HTTP, WebSocket, and DB connections
- **Timeout protection**: Forces shutdown after 30s if needed
- **In-flight request handling**: Allows requests to complete

### 7. Memory Leak Prevention

#### Measures:
- **Memory monitoring**: Checks every 5 minutes
- **Garbage collection**: Automatic GC when memory is high
- **Memory limits**: PM2 restarts at 800MB
- **Leak detection**: Warns when memory usage is high

### 8. Rate Limiting & Overload Protection

#### Existing Middleware:
- **API rate limiting**: Prevents API abuse
- **Auth rate limiting**: Protects authentication endpoints
- **Payment rate limiting**: Secures payment endpoints
- **Voice rate limiting**: Protects voice endpoints

### 9. Error Rate Circuit Breaker

#### Implementation:
- **Threshold**: 100 errors per minute
- **Auto-disable**: Temporarily disables endpoints on high error rate
- **Recovery**: Automatically recovers when error rate drops
- **Protection**: Prevents cascading failures

## Monitoring & Alerts

### Recommended Monitoring:
1. **Azure Application Insights**: Track errors, performance, dependencies
2. **Uptime monitoring**: External service (e.g., UptimeRobot)
3. **Error alerts**: Email/SMS on critical errors
4. **Performance monitoring**: Track response times

### Setup Application Insights:
```bash
az monitor app-insights component create \
  --app doclittle-insights \
  --location westus2 \
  --resource-group doclittle

az webapp config appsettings set \
  --name doclittle \
  --resource-group doclittle \
  --settings APPINSIGHTS_INSTRUMENTATIONKEY="<key>"
```

## Deployment Checklist

- [x] Comprehensive error handler implemented
- [x] Health check endpoints configured
- [x] Graceful shutdown implemented
- [x] Memory monitoring enabled
- [x] PM2 configuration created
- [x] Azure startup script created
- [ ] Azure health probe configured
- [ ] Application Insights configured
- [ ] Uptime monitoring setup
- [ ] Error alerting configured

## Best Practices

1. **Never let uncaught errors crash the app** - Always use try/catch
2. **Monitor memory usage** - Restart before OOM
3. **Use health checks** - Let Azure/K8s know app status
4. **Log everything** - Errors, warnings, important events
5. **Graceful degradation** - App should work even if some features fail
6. **Test failure scenarios** - Simulate crashes, DB failures, etc.

## Testing Reliability

```bash
# Test graceful shutdown
kill -SIGTERM <pid>

# Test memory limits
node --max-old-space-size=100 server.js

# Test error handling
curl -X POST /api/test-error

# Check health (use your deployed API origin)
curl "https://api.skinandcare.com/health?detailed=true"
# Legacy/alternate hostnames may still be allowlisted, e.g. https://api.myskinandcare.com/health?detailed=true
```

## Emergency Procedures

### If API Crashes:
1. Azure will auto-restart (within 30s)
2. Check logs: `az webapp log tail --name doclittle`
3. Review error logs in database
4. Check health endpoint
5. Scale up if needed: `az webapp scale --name doclittle --instance-count 2`

### If Database Issues:
1. App continues with degraded functionality
2. Check database file permissions
3. Review database logs
4. Restart app to reinitialize connections

## Conclusion

The API is now protected with multiple layers of reliability:
- ✅ Error handling prevents crashes
- ✅ Auto-restart on failure
- ✅ Health monitoring
- ✅ Memory leak prevention
- ✅ Graceful shutdown
- ✅ Database resilience
- ✅ Overload protection

**The foundation is solid and designed to run continuously.**




---

<a id="improvement-plan"></a>

## Codebase Improvement Plan


**Created**: 2025-01-27  
**Status**: Planning Phase  
**Approach**: Start with easiest tasks, build momentum

---

## 🏗️ Architecture Understanding

### Current System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI AGENT PLATFORMS                        │
│  ChatGPT (ACP) │ Google (AP2) │ Voice (Retell/VAPI)        │
└────────┬───────────┬───────────────┬────────────────────────┘
         │           │               │
         ▼           ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│              MIDDLEWARE PLATFORM                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ACP Adapter  │  │ AP2 Adapter  │  │Voice Adapter │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                 │              │
│         └──────────────────┼─────────────────┘              │
│                            ▼                                │
│              ┌─────────────────────────┐                   │
│              │  Payment Orchestrator    │                   │
│              │  (Universal Format)      │                   │
│              └─────────────┬───────────┘                   │
│                            ▼                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Stripe     │  │   Circle     │  │  Mastercard  │      │
│  │              │  │   (USDC)     │  │  Agent Pay   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATABASE LAYER                            │
│  SQLite (Primary) ──sync──> Postgres (Secondary)            │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Adapters** (`adapters/`)
   - Convert platform-specific formats → Universal `PaymentRequest`
   - ACP, AP2, Voice, Universal adapters

2. **Payment Orchestrator** (`services/payment-orchestrator.js`)
   - Central routing for all payment requests
   - Handles merchant fallback logic
   - Routes to payment methods (Stripe, Circle, etc.)

3. **Database Layer** (`database.js`)
   - SQLite primary database
   - Postgres sync for production
   - Automatic migrations

4. **Services** (`services/`)
   - 42+ service modules
   - Single responsibility principle
   - Business logic separation

5. **Routes** (`routes/`)
   - Express route handlers
   - Protocol-specific endpoints
   - Multi-tenant routing

---

## 📊 Current State Analysis

### Strengths ✅
- Solid architecture (Adapter pattern, Service layer)
- Comprehensive feature set
- Good security middleware
- Extensive documentation

### Weaknesses ⚠️
- **Code Organization**: Large files (server.js 11k+ lines, database.js 7.5k+ lines)
- **Logging**: Console.log everywhere (should use structured logging)
- **Constants**: Hardcoded values scattered (USDC decimals, merchant subdomain)
- **Error Handling**: Inconsistent error response formats
- **Monitoring**: No error tracking, no APM

---

## 🎯 Improvement Plan (Easiest First)

### Phase 1: Quick Wins (1-2 days)
**Goal**: Improve code quality with minimal risk

#### Task 1: Create Constants Configuration
**File**: `middleware-platform/utils/constants.js`

**Why**: Eliminate magic numbers and hardcoded strings

**Design**:
```javascript
module.exports = {
  // Currency
  USDC_DECIMALS: 1000000,
  DEFAULT_CURRENCY: 'USDC',
  
  // Merchant defaults
  DEFAULT_MERCHANT_SUBDOMAIN: 'akin-dunbar',
  
  // Payment
  DEFAULT_PAYMENT_METHOD: 'link',
  
  // Timeouts
  API_TIMEOUT_MS: 10000,
  DATABASE_QUERY_TIMEOUT_MS: 5000,
  
  // Rate Limits
  FREE_API_REQUESTS_PER_MONTH: 1000,
  
  // Fraud Detection
  FRAUD_RISK_THRESHOLDS: {
    LOW: 50,
    MEDIUM: 80,
    HIGH: 100
  }
};
```

**Impact**: 
- Single source of truth for constants
- Easy to update values
- Better code readability

---

#### Task 2-4: Replace console.log with Logger Service
**Files**: 
- `services/payment-orchestrator.js`
- `routes/voice.js`
- `database.js` (sync functions)

**Why**: Structured logging already exists but isn't used consistently

**Design**:
```javascript
// Current (bad)
console.log('✅ Merchant found:', merchant.name);
console.error('❌ Error:', error);

// New (good)
const logger = require('../services/logger');
logger.info('Merchant found', { merchant_id: merchant.id, name: merchant.name });
logger.error('Payment processing failed', { error: error.message, transaction_id });
```

**Impact**:
- Consistent log format
- Better production debugging
- Can add log levels (debug/info/warn/error)
- Ready for log aggregation

---

#### Task 5-6: Use Constants in Code
**Files**:
- `services/payment-orchestrator.js`
- `routes/voice.js`

**Why**: Remove hardcoded values, use centralized constants

**Design**:
```javascript
// Current (bad)
const usdcBalance = amount / 1000000; // USDC has 6 decimals
const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');

// New (good)
const constants = require('../utils/constants');
const usdcBalance = amount / constants.USDC_DECIMALS;
const fallbackMerchant = db.getMerchantBySubdomain(constants.DEFAULT_MERCHANT_SUBDOMAIN);
```

**Impact**:
- Single source of truth
- Easy configuration changes
- Better maintainability

---

### Phase 2: Infrastructure Improvements (2-3 days)
**Goal**: Add production-ready monitoring and error handling

#### Task 7: Centralized Config Helper
**File**: `middleware-platform/utils/config.js`

**Why**: Environment variables scattered, no validation

**Design**:
```javascript
class Config {
  static get(key, defaultValue = null) {
    return process.env[key] || defaultValue;
  }
  
  static require(key) {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required config missing: ${key}`);
    }
    return value;
  }
  
  static getInt(key, defaultValue = 0) {
    const value = this.get(key, defaultValue);
    return parseInt(value, 10);
  }
  
  static getBool(key, defaultValue = false) {
    const value = this.get(key, defaultValue);
    return value === 'true' || value === '1';
  }
}

module.exports = Config;
```

**Impact**:
- Type-safe config access
- Better error messages
- Centralized validation

---

#### Task 8: Error Tracking (Sentry)
**Why**: Errors go unnoticed in production

**Design**:
```javascript
// Install: npm install @sentry/node
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1
});

// In logger.js
error(message, error = null, data = {}) {
  if (error) {
    Sentry.captureException(error, {
      extra: { message, ...data }
    });
  }
  // ... existing logging
}
```

**Impact**:
- Real-time error alerts
- Error context and stack traces
- Production debugging

---

#### Task 9: Standardize Error Responses
**File**: `middleware-platform/utils/error-response.js`

**Why**: Inconsistent error formats across routes

**Design**:
```javascript
class ErrorResponse {
  static create(code, message, details = {}) {
    return {
      success: false,
      error: {
        code,
        message,
        ...details
      },
      timestamp: new Date().toISOString()
    };
  }
  
  static validation(errors) {
    return this.create('VALIDATION_ERROR', 'Validation failed', { errors });
  }
  
  static notFound(resource) {
    return this.create('NOT_FOUND', `${resource} not found`);
  }
  
  static unauthorized() {
    return this.create('UNAUTHORIZED', 'Authentication required');
  }
}

module.exports = ErrorResponse;
```

**Impact**:
- Consistent API responses
- Better client error handling
- Easier debugging

---

### Phase 3: Code Quality (3-5 days)
**Goal**: Reduce duplication and improve maintainability

#### Task 10: Phone Number Normalization Utility
**File**: `middleware-platform/utils/phone-normalizer.js`

**Why**: Phone normalization duplicated in multiple files

**Design**:
```javascript
class PhoneNormalizer {
  static normalize(phone) {
    if (!phone) return null;
    
    const digitsOnly = phone.replace(/\D/g, '');
    
    if (digitsOnly.length === 10) {
      return '+1' + digitsOnly;
    }
    
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return '+' + digitsOnly;
    }
    
    if (phone.startsWith('+')) {
      return phone;
    }
    
    return '+1' + digitsOnly;
  }
  
  static validate(phone) {
    const normalized = this.normalize(phone);
    if (!normalized) return false;
    return /^\+1\d{10}$/.test(normalized);
  }
}

module.exports = PhoneNormalizer;
```

**Impact**:
- Single implementation
- Consistent behavior
- Easy to test

---

#### Task 11: Request ID Middleware
**File**: `middleware-platform/middleware/request-id.js`

**Why**: Better request tracing

**Design**:
```javascript
const { v4: uuidv4 } = require('uuid');

function requestIdMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

module.exports = requestIdMiddleware;
```

**Impact**:
- Trace requests across services
- Better debugging
- Log correlation

---

### Phase 4: Monitoring & Performance (3-5 days)
**Goal**: Production-ready observability

#### Task 12: Enhanced Health Checks
**File**: `middleware-platform/middleware/health-check.js` (enhance existing)

**Why**: Basic health check doesn't verify dependencies

**Design**:
```javascript
async function healthCheck(req, res) {
  const checks = {
    database: await checkDatabase(),
    stripe: await checkStripe(),
    circle: await checkCircle(),
    retell: await checkRetell()
  };
  
  const allHealthy = Object.values(checks).every(c => c.status === 'ok');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  });
}
```

**Impact**:
- Know when dependencies are down
- Better incident response
- Kubernetes readiness probes

---

#### Task 13-14: Performance Logging
**Why**: Identify slow requests and queries

**Design**:
```javascript
// Request timing middleware
function performanceLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        path: req.path,
        duration: `${duration}ms`
      });
    }
  });
  next();
}

// Database query wrapper
function logSlowQueries(queryFn) {
  return async (...args) => {
    const start = Date.now();
    const result = await queryFn(...args);
    const duration = Date.now() - start;
    if (duration > 100) {
      logger.warn('Slow database query', {
        query: queryFn.name,
        duration: `${duration}ms`
      });
    }
    return result;
  };
}
```

**Impact**:
- Identify performance bottlenecks
- Proactive optimization
- Better user experience

---

#### Task 15: Automated Backups
**File**: `middleware-platform/scripts/backup-scheduler.js`

**Why**: Manual backups are error-prone

**Design**:
```javascript
// Use node-cron or similar
const cron = require('node-cron');
const backupScript = require('./backup-database');

// Daily backup at 2 AM
cron.schedule('0 2 * * *', async () => {
  logger.info('Starting scheduled database backup');
  try {
    await backupScript.run();
    logger.info('Database backup completed successfully');
  } catch (error) {
    logger.error('Database backup failed', error);
    // Send alert
  }
});
```

**Impact**:
- Automated backups
- No manual intervention
- Data safety

---

## 📋 Implementation Order

### Week 1: Quick Wins
1. ✅ Create constants file
2. ✅ Replace console.log in payment-orchestrator
3. ✅ Replace console.log in voice routes
4. ✅ Replace console.log in database sync
5. ✅ Use constants in payment-orchestrator
6. ✅ Use constants in voice routes

### Week 2: Infrastructure
7. ✅ Centralized config helper
8. ✅ Sentry integration
9. ✅ Standardize error responses
10. ✅ Phone normalization utility

### Week 3: Monitoring
11. ✅ Request ID middleware
12. ✅ Enhanced health checks
13. ✅ Performance logging
14. ✅ Database query logging
15. ✅ Automated backups

---

## 🎯 Success Metrics

- **Code Quality**: Reduced console.log usage by 80%
- **Maintainability**: All constants in one place
- **Observability**: 100% error tracking coverage
- **Performance**: Identify and fix top 5 slow queries
- **Reliability**: Automated daily backups

---

## 🚀 Next Steps

1. Review and approve this plan
2. Start with Phase 1 (Quick Wins)
3. Test each change thoroughly
4. Deploy incrementally
5. Monitor impact

---

**Note**: This plan focuses on **easiest tasks first** to build momentum. Each task is:
- Low risk (doesn't change core logic)
- High impact (improves code quality)
- Independent (can be done separately)
- Testable (easy to verify)



---

<a id="invoice-billing-implementation-summary"></a>

## Invoice Billing System - Implementation Summary


## Overview

This document summarizes the complete implementation of the invoice billing system for the platform. The system enables clinics to generate patient invoices from insurance claims, send them via email, and track payments. Customer-facing legal naming on invoices and receipts should follow [`docs/Brand/GUIDELINES.md`](../Brand/GUIDELINES.md) (**Doctor Little LLC** where a legal party is required).

## Implementation Date

December 2024

## Architecture

### Backend Components

#### 1. Database Schema (`middleware-platform/database.js`)

**Tables Created:**
- `invoices` - Main invoice records
  - Fields: id, claim_id, patient_id, invoice_number, status, amount, due_date, sent_at, paid_at, created_at, updated_at
- `invoice_items` - Line items for each invoice
  - Fields: id, invoice_id, service_date, description, cpt_code, icd_code, quantity, unit_price, total_price
- `invoice_payments` - Payment tracking
  - Fields: id, invoice_id, payment_date, amount, payment_method, reference_number, notes

**Database Functions:**
- `createInvoice(invoice)` - Create new invoice
- `getInvoice(id)` - Get invoice by ID
- `getInvoices(filters)` - List invoices with filters
- `updateInvoice(id, updates)` - Update invoice
- `addInvoiceItem(item)` - Add line item
- `getInvoiceItems(invoiceId)` - Get all line items
- `addInvoicePayment(payment)` - Record payment
- `getInvoicePayments(invoiceId)` - Get payment history
- `getInvoicePaymentsTotal(invoiceId)` - Calculate total paid
- `generateInvoiceNumber()` - Generate sequential invoice numbers (INV-YYYY-XXXXXX format)

#### 2. Invoice Service (`middleware-platform/services/invoice-service.js`)

**Key Functions:**
- `createInvoiceFromClaim(claimId, options)` - Generate invoice from claim with EOB calculation
- `calculatePatientResponsibility(patientId, claimId)` - Calculate patient responsibility from EOB
- `generateEmailTemplate(invoice, patient, items)` - Generate HTML/text email templates
- `isInvoiceOverdue(invoice)` - Check if invoice is past due date
- `getInvoiceSummary(invoiceId)` - Get complete invoice with items and payments
- `updateOverdueInvoices()` - Batch update overdue invoice statuses

**Integration:**
- Uses `EOBCalculationService` to determine patient responsibility
- Integrates with database for invoice CRUD operations
- Handles email template generation

#### 3. PDF Invoice Service (`middleware-platform/services/pdf-invoice-service.js`)

**Key Functions:**
- `generatePDF(invoice, items, patient, totals)` - Generate PDF invoice buffer
- `generateAndSavePDF(...)` - Generate and save PDF to file system

**Dependencies:**
- Requires `pdfkit` package (optional - emails work without it)
- Falls back gracefully if PDFKit not installed

#### 4. Invoice Routes (`middleware-platform/routes/invoices-clinic.js`)

**API Endpoints:**
- `POST /api/invoices/create-from-claim` - Create invoice from claim
- `GET /api/invoices` - List invoices with filters
- `GET /api/invoices/:id` - Get invoice details
- `PUT /api/invoices/:id` - Update invoice
- `POST /api/invoices/:id/send` - Send invoice email
- `POST /api/invoices/:id/payments` - Record payment
- `GET /api/invoices/:id/payments` - Get payment history

**Features:**
- Rate limiting on all endpoints
- Error handling and validation
- Patient data enrichment
- Payment status calculation

#### 5. Email Service Updates (`middleware-platform/services/email-service.js`)

**Enhancements:**
- Added `attachments` parameter support
- PDF attachment handling for SMTP
- Azure Communication Services fallback (without attachments)

### Frontend Components

#### 1. Invoice List Page (`unified-dashboard/business/invoices.html`)

**Features:**
- Full invoice list with status badges
- Search by invoice number, patient name, claim ID
- Filters: status, date range
- Actions: View, Send, Record Payment
- Real-time balance calculation
- Overdue invoice highlighting

#### 2. Invoice Detail Page (`unified-dashboard/business/invoice-detail.html`)

**Features:**
- Complete invoice information
- Line items table with CPT/ICD codes
- Payment history
- Action buttons (Send, Record Payment)
- Patient information display
- Link to source claim

#### 3. Claims Page Updates (`unified-dashboard/business/claims.html`)

**Enhancements:**
- "Generate Invoice" button on claim detail view
- Redirects to invoice detail after generation
- Works for all claim statuses (draft, submitted, approved)

#### 4. PDF Coding Page Updates (`unified-dashboard/business/pdf-coding.html`)

**Enhancements:**
- After claim creation, prompts to generate invoice
- Option to create invoice immediately or view claim first
- Seamless flow: PDF → Claim → Invoice

#### 5. Billing Pages

**Medical Billing (`unified-dashboard/business/medical-billing.html`):**
- Copy of billing.html for clinics
- Shows claims, EOB, and invoices
- Link to invoices page

**Commerce Billing (`unified-dashboard/business/commerce-billing.html`):**
- New page for shop tenants
- Shows voice credits, orders, revenue stats
- Links to orders and dashboard

#### 6. Tenant Configuration (`middleware-platform/routes/tenant-config.js`)

**Updates:**
- Clinic nav items include: Scan, Invoices, Patients, Billing (medical-billing.html)
- Shop nav items include: Products, Orders, Customers, Billing (commerce-billing.html)
- Dynamic routing based on tenant_type

## Workflow

### Complete Invoice Flow

1. **PDF Upload** → User uploads PDF on pdf-coding.html
2. **Code Extraction** → System extracts ICD-10 and CPT codes
3. **Claim Creation** → User creates claim from PDF data
4. **EOB Calculation** → System calculates Explanation of Benefits
5. **Invoice Generation** → User generates invoice from claim
   - Patient responsibility calculated from EOB
   - Invoice number auto-generated
   - Line items created from claim services
6. **Invoice Review** → User reviews invoice on invoice-detail.html
7. **Email Sending** → User sends invoice to patient
   - HTML email with invoice summary
   - PDF attachment (if PDFKit installed)
8. **Payment Tracking** → Staff records payments
   - Status updates automatically (sent → paid)
   - Balance calculated in real-time

## Key Features

### Invoice Management
- ✅ Automatic invoice number generation (INV-YYYY-XXXXXX)
- ✅ Patient responsibility calculation from EOB
- ✅ Line items with CPT/ICD codes
- ✅ Payment tracking with multiple payments per invoice
- ✅ Status management (draft → sent → paid/overdue)
- ✅ Overdue detection and status updates

### Email Integration
- ✅ HTML email templates
- ✅ Plain text fallback
- ✅ PDF attachment support (optional)
- ✅ Patient email extraction from FHIR data

### User Interface
- ✅ Full invoice list with filters and search
- ✅ Invoice detail view with payment history
- ✅ Status badges (draft, sent, paid, overdue)
- ✅ Tenant-based routing (clinic vs shop)
- ✅ Responsive design

## Database Migrations

The invoice tables are created automatically on first run via database migrations in `database.js`:
- Migration checks for table existence
- Creates tables with proper foreign keys
- Creates indexes for performance
- No manual migration needed

## Configuration

### Required Environment Variables

None - uses existing database and email configuration.

### Optional Dependencies

```bash
npm install pdfkit  # For PDF invoice generation
```

If PDFKit is not installed, invoices will still work but emails won't include PDF attachments.

## API Documentation

See `docs/api/README.md#invoice-api` for complete API reference.

## User Guide

See `docs/user-guides/INVOICE_WORKFLOW.md` for end-user documentation.

## Testing

### Manual Testing Checklist

- [ ] Upload PDF and create claim
- [ ] Generate invoice from claim
- [ ] View invoice list with filters
- [ ] Send invoice email
- [ ] Record payment
- [ ] Verify status updates
- [ ] Test overdue invoice detection
- [ ] Verify tenant routing (clinic vs shop)

## Known Issues

None currently identified.

## Future Enhancements

Potential improvements:
- Automated overdue invoice reminders
- Payment plan support
- Invoice templates customization
- Bulk invoice operations
- Export to accounting systems
- Patient portal for invoice viewing

## Files Created/Modified

### New Files
- `middleware-platform/services/invoice-service.js`
- `middleware-platform/services/pdf-invoice-service.js`
- `middleware-platform/routes/invoices-clinic.js`
- `unified-dashboard/business/invoice-detail.html`
- `unified-dashboard/business/medical-billing.html`
- `unified-dashboard/business/commerce-billing.html`
- `docs/api/README.md#invoice-api`
- `docs/user-guides/INVOICE_WORKFLOW.md`
- `docs/development/README.md#invoice-billing-implementation-summary` (this file)

### Modified Files
- `middleware-platform/database.js` - Added invoice tables and functions
- `middleware-platform/server.js` - Added invoice routes
- `middleware-platform/services/email-service.js` - Added attachment support
- `middleware-platform/routes/tenant-config.js` - Updated navigation routing
- `unified-dashboard/business/invoices.html` - Complete rewrite
- `unified-dashboard/business/claims.html` - Added Generate Invoice button
- `unified-dashboard/business/pdf-coding.html` - Added invoice generation prompt
- `unified-dashboard/business/billing.html` - Added tenant-based routing

## Code Quality

- ✅ No linter errors
- ✅ Error handling on all endpoints
- ✅ Input validation
- ✅ Rate limiting on API endpoints
- ✅ Consistent code style
- ✅ Comprehensive comments

## Deployment Notes

1. No database migrations needed (auto-created)
2. Install PDFKit for PDF support: `npm install pdfkit`
3. Restart server after deployment
4. Test invoice generation flow
5. Verify email sending works

## Support

For issues or questions:
- Check API documentation: `docs/api/README.md#invoice-api`
- Check user guide: `docs/user-guides/INVOICE_WORKFLOW.md`
- Review error logs in server console
- Check browser console for frontend errors



---

<a id="kelly-env-and-debug"></a>

## Voice / commerce LLM (`KELLY_*`) — environment and debugging

> **Naming:** Internal services and env vars use **Kelly** (`KellyAgentService`, `KELLY_*`). Customer-facing copy and chrome use **Skin & Care** / **Skin & Care assistant** — not “Kelly” as the product name ([`docs/Brand/GUIDELINES.md`](../Brand/GUIDELINES.md)).

Primary implementation: `middleware-platform/services/llm-router.js`, `middleware-platform/services/kelly-agent-service.js`.

See also **`middleware-platform/.env.example`** for full variable names.

## Provider selection

| Variable | Purpose |
|----------|---------|
| `KELLY_PRIMARY_PROVIDER` | `anthropic` (default when `ANTHROPIC_API_KEY` is set) or `groq` for Groq-only. |
| `ANTHROPIC_API_KEY` | Claude (Anthropic). If unset, router falls back to Groq with a warning. |
| `GROQ_API_KEY` | Groq; used as primary or fallback depending on `KELLY_PRIMARY_PROVIDER`. |
| `KELLY_ANTHROPIC_MODEL` | Anthropic model id (default `claude-sonnet-4-5`). |
| `KELLY_GROQ_MODEL` / `KELLY_GROQ_FALLBACK_MODEL` | Groq models for primary and compact retry paths. |
| `KELLY_PROVIDER_TIMEOUT_MS` | Per-request HTTP timeout for LLM calls (default 20000). |
| `KELLY_TURN_TIMEOUT_MS` | LLM turn-level timeout (documented in startup log). |
| `UNIFIED_CHANNEL_ADAPTER_ENABLED` | Feature flag for Phase 0 unified ingress adapter (`1`/`true` = use shared `adaptIncomingEvent` in chat + video ingress; default off keeps legacy paths). |
| `UNIFIED_CHANNEL_ADAPTER_SHADOW_ENABLED` | Shadow-mode adapter pass (`1`/`true` runs adapter side-by-side while legacy remains primary). |
| `CASE_DEIDENT_ENABLED` | Feature flag for de-identified case-pattern ingestion (`1`/`true` enables writing `case_patterns`; default off for dev/staging safety). |

## Streaming (commerce checkout SSE)

Streaming uses **`callStreamWithDeltas`** in `llm-router.js` so SSE paths respect the same primary provider as non-streaming `call()`.

## Debug logging (do not enable in production unless needed)

| Variable | Purpose |
|----------|---------|
| `KELLY_DEBUG=1` | Verbose traces in `kelly-agent-service.js` and `kelly-tool-executor.js` (per-tool, checkout, SLOTS, token recovery). |
| `KELLY_DEBUG_TURN=1` | Structured `[KellyDebug]` per-turn logs. |
| `KELLY_QUIET=1` | Skips the one-line Kelly startup config log. |
| `KELLY_LOG_STARTUP=1` | **Production:** re-enable the one-line Kelly startup log (off by default in `NODE_ENV=production`; dev/staging still logs unless `KELLY_QUIET=1`). |
| `KELLY_DEBUG_ANTHROPIC=1` | Logs truncated Anthropic request payload (router). |
| `DEBUG_LIVEKIT=1` | Verbose `POST /api/livekit/token` logs in `routes/livekit.js` (normally off in production; non-production is verbose by default). |
| `DEBUG_VIDEO_CONSULT_RAG=1` | Verbose `[video-consult][RAG]` query/merge logs in `services/video-consult-graph.js` (off in production unless set). |

## Production analytics

- RN checkout analytics: `patient-app/lib/checkoutAnalytics.ts` — optional sink `globalThis.__checkoutAnalyticsSink`.

## Future: structured logs

See **[STRUCTURED_LOGGING_FUTURE.md](./README.md#structured-logging-future)** (pino / correlation IDs — not implemented yet).


---

<a id="master-todo-full"></a>

## Platform — full backlog (internal roadmap)


**Last Generated:** April 6, 2026  
This document consolidates:

- The core platform roadmap from `MASTER_TODO.md`  
- The Agent / Prompt / Voice runtime backlog  
- The $1B‑scale financial and compliance hardening tasks
- The UX and safety backlogs for real-world clinical and financial use

---

## Phase 0b — Safety & Integrity (Pre‑requisites)

> Cross‑cutting guardrails that must be addressed early for clinical and financial safety, before deep scaling.

P0‑1. **Emergency warm transfer implementation**  
Implement end‑to‑end emergency egress mechanics: when red‑flag terms are detected, the Retell WebSocket handler must stop agent logic and trigger a Retell/Twilio/SIP warm or blind transfer to a pre‑configured crisis/triage line. Ensure no dead‑air (clear voice message, immediate transfer) and support for 11‑digit dial‑out / 911 hand‑off where legally appropriate.

P0‑2. **Medical STT configuration and NLU normalization**  
Select and configure a medical‑tuned STT backend (e.g., Deepgram Nova‑2 Medical, AWS Transcribe Medical, or equivalent) or a medical lexicon post‑processor on top of Retell transcripts. Normalize colloquialisms and drug/condition names into stable clinical concepts before urgency classification and ICD‑10 extraction.

P0‑3. **Dual‑layer urgency validation**  
Implement (a) a rule‑based keyword failsafe that forces high‑urgency/emergency flows when specific phrases are spoken, regardless of LLM output, and (b) a conservative secondary classifier that only flags high‑risk calls. Emergency egress should fire if either this layer or the primary LLM triage flags high risk.

P0‑4. **Provider ghosting / no‑show state machine**  
Design and implement explicit handling when a provider is assigned but never joins the LiveKit room within X minutes: mark the assignment as `provider_no_show`, re‑queue the patient with preserved or increased priority for the next batch, and increment a provider “ghosting” counter that feeds into reliability scoring and throttling.

P0‑5. **Visit charge timing decision (pre‑auth vs post‑capture)**  
Make and document a product/legal decision on when the main visit charge occurs (booking, session start, or post‑SOAP sign‑off) and reflect it in the ledger model: whether initial ledger entries are `pending` vs `settled`, how this interacts with no‑show deposit holds, and what refund patterns are supported.

---

## Part A — Core Platform Phases (from `MASTER_TODO.md`)

> Source of truth for core product, scheduling, matching, clinical features, and base payments.

```1:336:docs/MASTER_TODO.md
# Master TODO — Cash-Only Research-Backed Telehealth Platform


Consolidated task list for completing the platform. Built on current architecture: multi-tenant, Retell voice, LiveKit video, LangGraph, FHIR, `appointments`, `video_consult_sessions`, `voice_checkouts`, `clinics`, `fhir_patients`.

---

## Hybrid Architecture (Matching)

**LLM** = reasoning layer (triage, specialty inference, fit scoring, clinical cues).  
**Hungarian algorithm** = executor (mathematical optimization, fairness).

- LLMs for: subjective reasoning, synthesis, clinical nuance.
- Hungarian for: scalable assignment, determinism.
- **Phase 4c** hardens for clinical production: audit trail, feedback loops, emergency egress, cognitive load balancing, pre-match summary.

---

## Architecture Context (Current State)

| Component | Status | Notes |
|-----------|--------|-------|
| **Voice** | Retell WebSocket, `schedule_appointment`, `create_appointment_checkout`, `verify_checkout_code` | Flow: call → book → checkout → email code → payment link |
| **Video** | LiveKit rooms, Python agents → `POST /api/video-consult/agent-events` | LangGraph: accumulate → retrieve_context → human_review → store_fhir |
| **Data** | `appointments` (provider string), `video_consult_sessions`, `voice_checkouts`, `clinics`, `fhir_patients` | SQLite / optional Postgres |
| **Pricing** | Hardcoded $39.99 in `server.js` | No visit_pricing table |
| **Auth** | Admin: in-memory `admin_session`; Customer: `customer_sessions`; Provider: shared business login | No dedicated provider auth |
| **Matching** | None | No practitioners table, no match engine |

---

## Phase 0 — Critical Limitations (Fix First)

| # | Task | Details |
|---|------|---------|
| 1 | Remove $39.99 hardcode | Replace with `visit_pricing` table; add migration |
| 2 | Fix admin-auth in-memory sessions | Replace `admin_session` Map with DB-backed `admin_sessions` table (lost on Azure restart) |
| 3 | Create `visit_pricing` table | Keyed by `clinic_id` + `appointment_type`; base_price, surge_multiplier |
| 4 | Set base prices | $69 general consult, $109 therapy, $179 psychiatry initial, $99 psychiatry follow-up |
| 5 | Add `surge_enabled` to clinics | Boolean, default false (legal safety before dynamic pricing) |

---

## Phase 1 — Data Model Foundation

| # | Task | Details |
|---|------|---------|
| 6 | Create `practitioners` table | id, user_id, npi, name, specialty, clinic_id, circle_account_id, verification_status, availability_rules (JSON), star_rating, created_at |
| 7 | Create `practitioner_licenses` table | practitioner_id FK, state (indexed), license_number, verified — never JSON, state is core filter |
| 8 | Create `consult_sessions` table | id, appointment_id, practitioner_id, patient_id, status enum (triaging→matched→waiting_room→in_session→post_session→complete), livekit_room_name, retell_call_id, match_assignment_id |
| 9 | Link `video_consult_sessions` to `consult_sessions` | **Decided:** Keep separate. Add `consult_session_id` FK to video_consult_sessions; consult_sessions = lifecycle, video_consult_sessions = LiveKit metadata. Migration for existing rows. |
| 10 | Create `matching_cells` table | cell_id = `state_specialty_date_hourSlot`, demand_count, supply_count, surge_multiplier, updated_at |
| 11 | Create `match_requests` table | patient_id, appointment_type, state, preferred_date, preferred_time_start/end, clinical_urgency, status, batch_id, **reasoning_metadata** (JSON: clinical_cues, llm_triage_reasoning) — audit trail for human-in-the-loop |
| 12 | Create `match_assignments` table | batch_id, match_request_id, practitioner_id, slot_date, slot_time, cost_score, surge_multiplier, **cost_matrix_audit** (JSON: cost breakdown per factor), **pre_match_summary** (3-sentence clinical brief for provider Accept) |
| 13 | Create `provider_slots` table | practitioner_id, date, hour_slot, is_booked — pre-expanded from availability_rules |
| 14 | Create `matching_batch_queue` table | Track batch runs, prevent overlapping cycles |
| 15 | Create `provider_payouts` table | practitioner_id, amount, stripe_transfer_id, session_id, created_at |
| 16 | Add `practitioner_id` to appointments | Migration: backfill or default for existing rows |
| 17 | Add `preferred_practitioner_id` to fhir_patients | For continuity-of-care cost bonus |
| 18 | Add migration versioning | `migrations` table (version, applied_at) — current inline CREATE TABLE is untrackable |
| 19 | Create `specialty_mismatch_penalties` table | practitioner_id, specialty_or_icd_cluster, penalty, source (e.g. provider_feedback "not a fit"), created_at — feed cost-builder for outcome-based costs |

---

## Phase 2 — Provider Onboarding & Auth

| # | Task | Details |
|---|------|---------|
| 20 | Create `provider-auth.js` middleware | Mirror customer-auth; DB-backed `provider_sessions`; attach req.practitioner |
| 21 | Create `provider_sessions` table | session_id, practitioner_id, expires_at, created_at |
| 22 | Implement POST /api/provider/signup | name, email, NPI, specialty, state(s), email verify flow; creates practitioners row verification_status=pending |
| 23 | NPI verification via NPPES | Call `https://npiregistry.cms.hhs.gov/api/?number={npi}`; validate name, taxonomy, state; set verification_status=verified |
| 24 | Provider availability rules UI | Form in dashboard; weekly hours (Mon 9–17); store in practitioners.availability_rules |
| 25 | Scope business dashboard to practitioner_id | Today's schedule, earnings, patient queue; RBAC per practitioner |
| 26 | Clinic scoping for practitioners | Ensure clinic_id in all practitioner queries; multi-tenant isolation |

---

## Phase 3 — Scheduling Infrastructure

| # | Task | Details |
|---|------|---------|
| 27 | Extend getAvailableSlots to be practitioner-aware | Accept practitioner_id; query practitioners.availability_rules; check appointments WHERE practitioner_id=? |
| 28 | Provider slot indexer job | Background job (nightly or on availability change); expand availability_rules → provider_slots for next 14 days |
| 29 | Define Google Calendar vs provider_slots | Replace Calendar with provider_slots, or sync both (Calendar for external blockers) |
| 30 | No-show deposit-hold | Stripe authorize-only (capture_method: manual); capture on in_session; cancel if cancelled >24h; $25 no-show fee otherwise |

---

## Phase 4 — Matching Engine

| # | Task | Details |
|---|------|---------|
| 31 | Implement cost-builder.js | N×M cost matrix: wait_time (0.3), specialty_mismatch (0.4), provider_load (0.2), state_license (0.1); loyalty bonus -10 for preferred |
| 32 | ICD-10 → specialty mapping | Knowledge/ JSON: F-codes→psychiatry, M→physio, L→dermatology; feed specialty_mismatch; use provider_trust_metrics |
| 33 | Greedy matcher (Phase 4a) | Sort by urgency + created_at; assign to lowest-cost slot; fallback for Hungarian |
| 34 | Hungarian algorithm (Phase 4b) | munkres npm; full cost matrix; dummy columns for unmatched; globally optimal |
| 35 | Batch processor (setInterval 3 min) | 1) SELECT pending match_requests 2) batch_id 3) cost-builder 4) solver 5) match_assignments 6) consult_sessions→matched 7) notify patients 8) unmatched stay in queue |
| 36 | POST /api/matching/request | Enqueue match_request; return request_id, estimated_wait_min |
| 37 | GET /api/matching/status/:request_id | Return status, assigned_provider, slot, surge_multiplier, estimated_wait_min |
| 37b | POST /api/matching/cancel | Cancel match_request in pending/processing; set status=cancelled; used by UI-84 |

---

## Phase 4c — Matching Hardening (Clinical Safety)

| # | Task | Details |
|---|------|---------|
| 38 | **Reasoning Loop audit trail** | Store LLM clinical cues in match_requests.reasoning_metadata (e.g. "Patient mentioned 'crushing' chest pain, elevated to Urgent"); cost_matrix_audit in match_assignments. Human-in-the-loop audit UI. |
| 39 | **Emergency egress (dead-end logic)** | Before cost-builder: LLM triage detects high-acuity keywords (suicidal ideation, stroke symptoms) → bypass Hungarian entirely; trigger warm handover to human or 911. Never force-match emergencies. |
| 40 | **Feedback loop (re-matching penalty)** | When provider declines "not a fit": write to specialty_mismatch_penalties; cost-builder reads and increases specialty_mismatch for that (practitioner_id, specialty/icd_cluster) pair in future batches. |
| 41 | **Cognitive load balancing** | Track recent high-intensity encounters per practitioner (trauma/PTSD, etc.); reasoning layer temporarily increases cost for similar cases to prevent burnout even when technically available. |
| 42 | **Pre-match summary (mini-SOAP)** | Voice agent produces 3-sentence clinical brief; send to practitioner with match request; provider Accept/Decline flow before consult_sessions→matched. Store in match_assignments.pre_match_summary. |

---

## Phase 5 — Surge & Dynamic Pricing

| # | Task | Details |
|---|------|---------|
| 43 | surge-service.js | Per-cell: demand/supply ratio; multiplier = 1.0 + 0.1×max(0, ratio-1); cap 1.5× |
| 44 | Cell demand/supply counters | Increment on match_request insert; update on slot book/release |
| 45 | visit_pricing API | GET /api/pricing?clinic_id&appointment_type; POST /api/admin/pricing; wire into create_appointment_checkout |

---

## Phase 6 — Visit Infrastructure (Retell → LiveKit Handoff)

| # | Task | Details |
|---|------|---------|
| 46 | Implement consult_sessions state machine | triaging→matched→waiting_room→in_session→post_session→complete; emit events |
| 47 | Define Retell → LiveKit flow | **Decided:** Voice creates match_request. Agent says "We'll find a provider and text/email you a link." Patient polls status; LiveKit link after match. |
| 48 | Store retell_call_id on consult_sessions | Link Retell transcripts/flow to session |
| 49 | Auto LiveKit room creation on match | When match_assignment + status→matched: create room, tokens, send join link |
| 50 | Update Retell tools for matching | Retell schedule_appointment → create match_request (same as app). Update get_available_slots or remove; agent uses POST /api/matching/request. |
| 51 | Align LangGraph with consult_sessions | Trigger on post_session/complete; pass consult_session_id; store outputs linked to session |
| 52 | Wire symptom triage / risk events | video_consult_risk_events → consult_sessions; escalation rules |

---

## Phase 7 — Clinical (PRO & Outcomes)

| # | Task | Details |
|---|------|---------|
| 53 | PHQ-9 / GAD-7 pre-visit collection | Send form link after match; store via assessmentToFHIRObservation(); display in provider HUD |
| 54 | Post-visit SOAP note generation | LangGraph: Subjective, Objective, Assessment, Plan from transcript; FHIR Communication |
| 55 | Post-visit outcome collection | 24h after complete: PHQ-9/GAD-7 + satisfaction; FHIR Observations; time-series to pre-visit |
| 56 | Notification contracts | Match found, reminder, outcome survey, no-show; extend EmailService, ReminderScheduler |

---

## Phase 8 — Payments & Settlement

| # | Task | Details |
|---|------|---------|
| 57 | Wire create_appointment_checkout to visit_pricing | Replace hardcoded amount; use GET /api/pricing |
| 58 | Stripe Connect for provider payouts | Onboard practitioners to Stripe Connect Express; transfer on complete |
| 59 | Settlement trigger on session complete | consult_sessions→complete → Stripe Connect transfer; idempotency |
| 60 | Simplify cash-only | **Decided:** Deprecate Circle patient wallets. Stripe card only for launch. Hide/remove patient wallet UI. |

---

## Phase 9 — Patient App

| # | Task | Details |
|---|------|---------|
| 61 | Booking screen | appointment_type → date range → POST /api/matching/request → poll status → assigned provider + slot |
| 62 | Provider profile card | name, specialty, star_rating, NPI verified; accept or 1 re-match |
| 63 | Patient identity for matching | Ensure fhir_patients.resource_id stable; auth/session for matching |
| 64 | Extend intake | DOB, address; **consent for research required** before first PHQ-9/GAD-7 (see task 89). |

---

## Phase 10 — Operational & Compliance

| # | Task | Details |
|---|------|---------|
| 65 | HIPAA audit logging | Populate hipaa_access_log for patient access, FHIR reads/writes, payment events |
| 66 | Cost control | Rate limits for LangGraph, RAG; per-clinic caps (VIDEO_CONSULT_MAX_COST_PER_SESSION) |
| 67 | Feature flags | New matching vs legacy; new pricing vs hardcode; deposit-hold vs capture; rollback path |
| 68 | E2E test | Voice book → match → payment → LiveKit join → SOAP/outcome |
| 69 | Monitoring | Matching batch duration; unmatched rate; Stripe Connect failures; LangGraph failures |

---

## Phase 11 — Vision & P2 Items

| # | Task | Details |
|---|------|---------|
| 70 | Vision pipeline (P2) | Wire vc_yolo_probe / vision_frame to GPT-4o; FHIR Observation; max frames per session |
| 71 | In-app video join (P2) | Native LiveKit SDK in Expo instead of browser link |
| 72 | Outcome forms in app (P2) | Native PHQ-9/GAD-7; longitudinal score trends |
| 73 | Predictive demand model (P2) | Time-series per cell; pre-populate surge 48h; need 3mo data first |
| 74 | No-show prediction (P2) | Per-patient probability; feed cost-builder |

---

## Decisions (Resolved)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | **Retell voice booking: matching vs bypass?** | **Voice goes through matching.** Agent creates `match_request` (same as app); patient gets link to poll status. One path for consistency; triage feeds reasoning layer. For Urgent/Emergent, emergency egress bypasses matching. |
| 2 | **consult_sessions vs video_consult_sessions?** | **Keep separate, linked.** `consult_sessions` = lifecycle (triaging→matched→…→complete). `video_consult_sessions` = LiveKit/technical metadata. Add `consult_session_id` FK to video_consult_sessions; consult_sessions is source of truth. |
| 3 | **Circle patient wallet: deprecated or kept?** | **Deprecate for cash-only launch.** Stripe card only. Simplifies flow. Circle can return later if crypto payments needed. |
| 4 | **Patient research consent before PHQ-9/GAD-7?** | **Yes, required** before first PRO form. Consent screen/checkbox; store in fhir_patients or consent table. Block PRO until consent given. |

---

## Phase 12 — UI Tasks

### Provider UI

| # | Task | Details |
|---|------|---------|
| 75 | Provider NPI verification status screen | Show verification_status (pending/verified/rejected) with next steps after signup |
| 76 | Provider re-verification flow | If NPI check fails: correct NPI/specialty/states, resubmit; link to specialty_mismatch_penalties on decline |
| 77 | Provider decline reason UI | Accept/Decline modal: dropdown or text for decline reason (e.g. "not my sub-specialty", "schedule conflict"); feeds specialty_mismatch_penalties (task 40) |
| 78 | Pre-match summary display | Format for 3-sentence clinical brief in Accept/Decline screen; task 42 output |
| 79 | Stripe Connect onboarding UI | OAuth flow: identity verification, bank account; redirect from Stripe Connect Express |
| 80 | Stripe Connect status screen | Show Connect account status (pending, active, restricted); earnings, transfer history |
| 81 | Session complete screen (provider) | Post "End & Create Claim": show auto-generated SOAP note for review/sign-off; update flow since SOAP is now auto |
| 82 | Cognitive load indicator | Provider dashboard: "Light day / Moderate / Heavy" from recent high-intensity cases; self-management |
| 83 | Longitudinal score display (provider) | HUD + visit history: PHQ-9/GAD-7 trend over multiple visits, not just pre-visit |

### Patient UI

| # | Task | Details |
|---|------|---------|
| 84 | Patient match cancellation | In match_waiting: Cancel/Exit button; POST /api/matching/cancel (task 37b); return to booking or home |
| 85 | Re-match flow UI | After "Request re-match": return to waiting state; "Finding new provider…"; poll status; limit 1 re-match |
| 86 | Session complete screen (patient) | Post-visit: "Visit complete. You'll receive a follow-up survey in 24h." + optional summary |
| 87 | No-show fee receipt/notification | When $25 no-show charge fires: email + in-app notification; receipt UI with amount, date |
| 88 | Emergency egress UI | When triage triggers warm handover: "Connecting you with urgent support. Please stay on the line." No matching queue shown |
| 89 | Patient consent screen | Before first PHQ-9/GAD-7: consent checkbox + explanation; store consent; block PRO until given |
| 90 | PHQ-9/GAD-7 web form (public URL) | `/patients/pro/phq9` or similar; tokenized link from email; submit → FHIR Observation; landing page |
| 91 | Outcome survey landing page | `/patients/pro/outcome`; 24h email link; PHQ-9/GAD-7 + satisfaction; submit → FHIR |

### Appointments & Mixed State

| # | Task | Details |
|---|------|---------|
| 92 | Appointments list (mixed state) | Rows with practitioner_id show provider; rows without (legacy/Retell direct) show "Assigned provider TBD" or clinic name; consistent UX |

### Admin / Ops UI

| # | Task | Details |
|---|------|---------|
| 93 | Admin: specialty_mismatch_penalties | View/override penalties; task 19 backend |
| 94 | Admin: reasoning audit (wireframe) | View reasoning_metadata, cost_matrix_audit; task 38; define layout |
| 95 | Admin: per-clinic cost caps | Set VIDEO_CONSULT_MAX_COST_PER_SESSION per clinic; task 66 |
| 96 | Admin: feature flags UI | matching vs legacy, pricing vs hardcode, deposit-hold vs capture; task 67 |
| 97 | Ops: monitoring dashboard | Batch duration, unmatched rate, Stripe Connect failures, LangGraph failures; task 69 |
| 98 | Admin: HIPAA access log viewer | Query/filter hipaa_access_log; task 65 |

---

## Phase 13 — Transcript & Storage

### Data Model & Linkage

| # | Task | Details |
|---|------|---------|
| 99 | voice_call_log: patient_id, appointment_id, call_type | Add columns to voice_call_log; store call_id → patient_id → appointment_id. Upsert when patient_id resolved during call (schedule_appointment, collect_insurance). Migration. |
| 100 | voice_call_log: call_type enum | inbound_booking, inbound_triage, outbound_reminder, outbound_outcome_survey, outbound_no_show_followup. Different handling downstream. |
| 101 | Push voice transcripts to fhir_communications on call end | When call ends (Retell webhook or WebSocket disconnect) + patient_id known: write transcript to fhir_communications with patient_id, encounter_id=NULL if no encounter. Idempotency by call_id. Requires call-end trigger. |
| 102 | Voice transcript linkage when patient unidentified | Store in voice_conversation_memory with `unlinked` flag. Background job: periodically attempt to link unlinked transcripts to patients via phone lookup. |
| 103 | Create FHIR encounter at clinical interaction start (voice) | On first clinical turn/tool call with patient context, create encounter—not just on completion. Prevents transcript loss if call drops. |
| 104 | Link video_consult_sessions transcript to consult_sessions | After consult_session_id FK: ensure video transcript (metadata.audio_transcript) also written to fhir_communications linked to consult_sessions. |
| 105 | Durable transcript retention policy | Nightly job: find voice_conversation_memory rows with known patient_id (via call_id → voice_call_log) but no fhir_communications; backfill before 30-day purge. |
| 106 | Idempotency for transcript push | Dedupe by call_id before inserting fhir_communications. Prevent double-write if processVoiceCall and on-call-end handler both run. |

### Video Transcript Analysis

| # | Task | Details |
|---|------|---------|
| 107 | Real-time transcript analysis during video | Lightweight pass during in_session: flag high-acuity keywords (suicidal ideation, chest pain, stroke) as they appear; trigger emergency egress immediately, not post-session. |
| 108 | Unified transcript format | Canonical schema: { timestamp, speaker_role (patient/provider/agent), text, source (retell/livekit) }. Normalize both sources before fhir_communications. |
| 109 | Speaker diarization for video | Preserve speaker labels in LiveKit transcript so SOAP generation knows who said what. |
| 110 | Post-video LLM analysis pipeline | After in_session → post_session: full transcript → LLM for (1) SOAP note, (2) ICD-10/CPT, (3) risk flags, (4) PHQ-9/GAD-7 inference if verbal. Store all linked to consult_session_id. |
| 111 | Transcript search endpoint | GET /api/transcripts/search?patient_id&date_from&keyword. Backed by fhir_communications. For provider search and RAG at scale. |

### Analysis & Clinical Intelligence

| # | Task | Details |
|---|------|---------|
| 112 | Clinical cue extraction from all transcript sources | LLM pass on every completed transcript (voice or video): chief complaint, medications, symptom duration, risk flags. Store as fhir_observations linked to encounter. Feed matching fit scoring. |
| 113 | Sentiment and distress scoring | Sentiment analysis on patient speech turns. Store distress_score as FHIR Observation. Feed: (1) provider HUD real-time, (2) matching for high-distress → experienced providers. |
| 114 | Cross-session clinical continuity | When provider joins video: pull prior fhir_communications + fhir_observations for patient; summarize into pre-session brief. Display in provider HUD. |
| 114b | voice_conversation_memory: unlinked flag | Add `unlinked` column (boolean); set true when patient_id unknown at call end. Background job (task 102) uses for linkage attempts. Migration. |
| 114c | Transcript encryption at rest (P2) | HIPAA: encrypt transcript content before insert; decrypt on read. Use TRANSCRIPT_ENCRYPTION_KEY. Optional for launch. |

---

## Phase 14 — Retell Inbound & Outbound

### Inbound vs Outbound Pipeline

| # | Task | Details |
|---|------|---------|
| 115 | Inbound call transcript pipeline | Ensure inbound (patient calls in → booking/triage) captures transcript to voice_conversation_memory AND fhir_communications when patient_id resolved. Same path as outbound. |
| 116 | Outbound call transcript pipeline | Outbound: platform initiates (reminders, surveys, no-show). Transcript stored with originating context (appointment_id, survey_type) in voice_call_log; not just call_id. |
| 117 | Retell outbound API integration | Backend: call Retell Create Call API to initiate outbound. Pass context (appointment_id, call_type) for routing and transcript linkage. |
| 118 | Retell outbound for reminders | Replace or supplement EmailService.sendAppointmentReminder. 1h before: Retell calls patient, confirms attendance. Transcript stored. Cancel flow if patient cancels on call. |
| 119 | Retell outbound for outcome surveys | 24h post-visit: Retell calls patient, administers PHQ-9/GAD-7 verbally. LLM extracts responses → FHIR Observations. Fallback to email form if unanswered after 2 attempts. |
| 120 | Retell outbound for no-show followup | Patient no-shows: Retell calls within 30 min, offers reschedule. Transcript stored. If agreed, create new match_request. |
| 121 | Inbound during active video session | If patient calls Retell while consult_sessions status = in_session: detect via lookup; handle gracefully (e.g. "You're in a visit—please stay in the video room") instead of new booking flow. |

---

## Summary

| Phase | Tasks | Count |
|-------|-------|-------|
| 0 — Critical Limitations | 1–5 | 5 |
| 1 — Data Model Foundation | 6–19 | 14 |
| 2 — Provider Onboarding & Auth | 20–26 | 7 |
| 3 — Scheduling Infrastructure | 27–30 | 4 |
| 4 — Matching Engine | 31–37 | 7 |
| 4c — Matching Hardening | 38–42 | 5 |
| 5 — Surge & Dynamic Pricing | 43–45 | 3 |
| 6 — Visit Infrastructure | 46–52 | 7 |
| 7 — Clinical (PRO & Outcomes) | 53–56 | 4 |
| 8 — Payments & Settlement | 57–60 | 4 |
| 9 — Patient App | 61–64 | 4 |
| 10 — Operational & Compliance | 65–69 | 5 |
| 11 — Vision & P2 | 70–74 | 5 |
| 12 — UI Tasks | 75–98 | 24 |
| 13 — Transcript & Storage | 99–114c | 18 |
| 14 — Retell Inbound & Outbound | 115–121 | 7 |
| **Total** | | **123** |

**Critical path:** Phases 0–4 + 4c (foundations + matching + clinical hardening). Phases 5–12 build on a working practitioner model and matching engine.

**Decisions:** 4 resolved — Retell→matching; consult_sessions separate; Circle deprecated; consent required before PRO.
```

---

## Part B — Agent / Prompt / Voice Runtime Backlog

> Cross‑channel “brain” service, prompt control, tools, and reliability for voice + future chat.

### B1. AgentBrainService & session runtime

1. Design `AgentBrainService` interface and data structures (processTurn contract, history shape, action types).
2. Implement `AgentBrainService` in middleware with base system prompt, clinic‑aware prompt assembly, and LLM client.
3. Implement conversation memory + token‑budget management for voice sessions.
4. Wire `AgentBrainService` into `retell-websocket.js` to handle transcripts and send voice responses.
5. Implement agentic tool orchestration loop (`call_tool` actions, execute tools, re‑invoke brain).
6. Implement voice interrupt handling (user barge‑in detection from Retell, cancellation of in‑flight LLM/tool work, restart of turn).
7. Add streaming response support from LLM to Retell (token streaming, partial responses, fallback to non‑streaming).

### B2. Prompt profiles, safety, and admin UX

8. Design and migrate DB schema for `prompt_profiles` with versioning and status (draft/active/archived).
9. Implement prompt checksum/hash generation and store with each compiled prompt.
10. Implement prompt audit logging table `prompt_audit_logs` to track who edited which prompt, when, and what changed.
11. Expose REST APIs for listing, creating, updating prompt profiles and setting clinic defaults.
12. Implement prompt linting and guardrails to enforce base safety prompt and detect risky doctor instructions.
13. Implement prompt injection defenses in `AgentBrainService` to detect and mitigate malicious caller instructions.
14. Add admin UI in dashboard for editing prompt profiles using structured controls and optional free‑text.
15. Add prompt sandbox UI for doctors/admins to test prompts in a safe preview environment.

### B3. State, reliability, degraded mode

16. Design and implement lightweight conversation state manager (e.g., GREETING, INTAKE, INSURANCE, SCHEDULING, CONFIRMATION).
17. Implement tool reliability layer (`ToolReliabilityService`) with per‑tool timeouts, simple retry policy, and safe fallback messages.
18. Implement degraded mode controller triggered by repeated LLM/tool failures, with simplified behavior or escalation.
19. Introduce trace IDs across WebSocket, `AgentBrainService`, and tools for per‑call/turn tracing.
20. Add rate limiting and abuse protection for calls, turns, and token usage per tenant/session.
21. Create background jobs to clean up sessions, enforce data retention, and archive transcripts per policy.

### B4. Logging, tracing, and observability

22. Extend logging/audit (call logs + `agent_turns`) to capture `prompt_profile_id`, version, model, latency, and transcripts.
23. Build synthetic conversation testing framework to replay scripted dialogs against prompts and tools.
24. Add unit tests for `AgentBrainService` with mocked LLM and history truncation.
25. Write a runbook documenting how clinics configure prompts and how to debug a call end‑to‑end.

### B5. Human handoff, escalation, financial tools

26. Add human handoff / escalation actions (`handoff_to_human`, `transfer_call`, `schedule_callback`) to `processTurn`.
27. Wire Retell adapter to perform real call transfers or callback scheduling for handoff actions.

---

## Part C — $1B‑Scale Ledger, Payments, and Compliance Backlog

> Tasks focused on getting to $1B+ in annual patient / insurer / provider flows with verifiable correctness.

### Circle / USDC vs cash‑only launch

- **Launch decision (Phase 8 / task 60):** Cash‑only, Stripe‑card flows; Circle patient wallets deprecated for the initial GA.
- **Scale decision (this Part C):** Re‑introduce Circle/USDC and multi‑rail architecture **after** cash‑only flows are stable and regulatory requirements (C4) and DB migration (C5‑53) are complete.
- Treat Circle and multi‑rail work as **feature‑flagged**: all C1–C3 tasks should ship behind config so the platform can run Stripe‑only or Stripe+Circle per environment/tenant.

### Critical dependencies / ordering

- **DB migration first:** Task **C5‑53 (SQLite → Postgres/Cockroach)** is a **hard prerequisite** for:
  - All **C1 – Ledger & wallet foundation** tasks.
  - All **C2 – Payment rails** tasks.
  - Any financial reconciliation or high‑volume RCM work that depends on durable transactions.
- **Emergency egress depends on risk detection:**
  - Phase **4c‑39 (Emergency egress)** depends on transcript and risk‑signal plumbing from **Phase 13‑107 (real‑time transcript analysis)** and **Phase 13‑112 (clinical cue extraction)**.
  - Implementation order should be: basic transcript pipeline → risk keyword / cue detection → emergency egress decision + routing.

### C1. Ledger & wallet foundation

28. Design canonical account model: `ledger_accounts` (owner_type patient/provider/insurer/system, owner_id, currency, rail_type stripe/circle/internal, status) and invariants (no negative balances; debits == credits; immutability).
29. Implement double‑entry `ledger_entries` table with `id`, `account_id`, `debit`, `credit`, `currency`, `external_ref_type`, `external_ref_id`, `created_at`, `status`.
30. Wrap all money‑moving operations (Stripe charges, Circle transfers, wallet credits, invoice payments) in a “decision → ledger entries → rail call → status update” pattern.
31. Add idempotency keys at the ledger layer to prevent duplicate entry creation on retries.
32. Implement per‑patient / per‑provider / per‑insurer wallet summary APIs driven solely from ledger balances.
33. Backfill existing payment data into the ledger where feasible, or define a clear cutover height.

### C2. Payment rails (Stripe, Circle, hybrid)

34. Define and document three canonical rails: Rail A (cash / Stripe only), Rail B (hybrid copay via Stripe + insurer via Circle), Rail C (insurance‑only).
35. Define canonical payment rail state machines for each rail (intent_created → authorized → captured → settled → failed/refunded) and document invariants.
36. Implement a single `payment_orchestrator` contract that all callers (voice, app, RCM) use to drive these rail state machines.
37. Integrate ledger with Stripe flows so each payment intent and payout creates appropriate pending and settled ledger entries, including refunds/chargebacks.
38. Integrate ledger with Circle flows so each transfer and escrow movement has matching ledger entries; treat escrow as its own ledger account.
39. Formalize hybrid claim → payment choreography in one orchestrator (`rcm-service` or dedicated `claim-settlement-orchestrator`) with idempotent claim submissions and payments.

### C3. RCM, Stedi, and payer APIs

40. Harden Stedi production integration: strict config for sandbox vs production, and gated simulation modes for dev only.
41. Implement per‑payer routing: some payers via Stedi, others via direct FHIR, based on configuration.
42. Implement `payer-gateway-service` with `checkEligibility`, `submitClaim`, `getClaimStatus` that chooses Stedi vs FHIR per payer capabilities.
43. Add per‑payer, per‑tenant budgets and usage accounting for Stedi/FHIR calls with hard/soft limits and alerting.
44. Add metrics and alerts for Stedi and FHIR failure rate and latency per payer.

### C4. Regulatory, AML/KYC, and governance

45. Perform money transmitter licensing and regulatory assessment for Circle/USDC and payment flows.
46. Integrate AML/sanctions screening on wallet and payment transactions.
47. Implement KYC/KYB workflows for new providers and insurers onboarding to wallets.
48. Set up HIPAA BAA management and tracking for all PHI‑handling vendors and financial vendors.
49. Centralize secrets and keys (Stedi, UHC OAuth, Stripe, Circle, DB) in a secrets manager and implement key rotation.
50. Define roles/permissions for internal services and agent tool calls; enforce authorization checks on all financial and PHI operations.
51. Implement audit logging for all access to PHI and all financial actions (who did what, when, from where).
52. Implement data retention and deletion policies for financial records and PHI; document data flows and BAAs.

### C5. Database, migration, and infra

53. Migrate financial and other high‑write tables from SQLite to Postgres/Cockroach with proper transactions and replication.
54. Add appropriate indexes for all hot ledger, claim, and payer‑API queries.
55. Implement queues / job workers for long‑running or retryable operations (claim submission, reconciliation, payouts).
56. Ensure critical services are stateless (session/state in DB/Redis) so app instances can be scaled horizontally.

### C6. Failure patterns, DLQ, sagas

57. Add DLQ and retry strategy for financial tool calls with side effects, including compensating actions.
58. Model key payment and claim flows as sagas with compensating transactions for partial failures.
59. Add circuit breakers and backoff strategies for Circle/Stripe/Stedi outages beyond current fallbacks.
60. Design and run chaos scenarios for financial flows (external outages, partial successes, delayed webhooks) and verify no double‑charge/credit and clean recovery.

### C7. Unified financial timeline and user‑visible tracing

61. Build a unified financial event log that normalizes Circle, Stripe, and Stedi events per patient/provider/insurer on top of the ledger.
62. Build financial timelines for patient and provider portals that narrate visit → claim → EOB → payments, sourced only from ledger + reconciliation.
63. Guarantee visit/encounter linkage for all financial events: every claim, EOB, ledger entry, and transfer references a `consult_session_id` / Encounter ID; add DB constraints where possible.

### C8. Observability, metrics, and SLOs

64. Instrument metrics for every financial event (ledger entries, rail calls, status changes) and claim lifecycle stages.
65. Define and instrument SLOs for eligibility latency, claim adjudication latency, and payout latency; surface in internal dashboards.
66. Add jobs and alerts for claims stuck in `submitted/processing`, transfers stuck in `pending`, or any ledger imbalance / reconciliation delta beyond tolerance.

### C9. Testing, load, and security

67. Add unit and integration tests for ledger invariants (no negative balances; debits == credits) and for each payment rail (happy paths + errors).
68. Add property‑based tests and invariants for escrow split logic (e.g., 50/20/20/10) and related calculations.
69. Build synthetic datasets (thousands of claims) and run end‑to‑end RCM + payments + reconciliation tests; verify no money lost and balances reconcile.
70. Design and run load/stress tests simulating $1B+ payment volume across rails before go‑live.
71. Run static analysis and dependency scanning for financial and PHI services.
72. Schedule third‑party penetration testing and security audit for the voice agent and financial APIs.
73. Create a formal threat model for voice channel (spoofing, social engineering, payment abuse) and mitigation plan.
74. Add strict guardrails for payment‑related tools (limits, whitelists, confirmation flows) beyond prompt‑level safety.
75. Author on‑call incident runbooks for payment/escrow failures and major outages.
76. Define and implement backup and disaster recovery plan specifically for financial and ledger tables.

### C10. Disputes, exceptions, and provider payout issues

77. Design and implement flows for **provider payment disputes** (Stripe Connect transfers and Circle payouts), including:
    - Dispute intake and tracking (who raised it, which session/claim/transfer).
    - Temporary holds or adjustments on future payouts while disputed amounts are investigated.
    - Reconciliation between ledger entries and external dispute outcomes (Stripe/Circle).
78. Add admin/Ops tooling to view and resolve disputes, with full audit trail of adjustments and justifications.

### C11. Consent management and provider credentialing extensions

79. Implement a centralized **Consent Service** that:
    - Tracks consent artifacts (type, text/version, channel, timestamp, actor, revocation).
    - Links consents to patients and specific features (research PROs, data sharing, recording, financial authorizations).
    - Exposes APIs to check “is consent X valid?” at call‑time and to log revocations.
80. Refactor existing consent usage (tasks 64, 89, and related screens) to use the Consent Service instead of ad‑hoc flags on `fhir_patients`.
81. Extend provider credentialing beyond NPI:
    - DEA number capture and verification for prescribers.
    - Malpractice insurance capture (policy number, carrier, expiry) and periodic verification.
    - State medical board sanction checks where available.
    - Surface credential status in provider onboarding and admin views.

### C12. Financial tool rate limits, on/off‑ramps, and infra resilience

82. Implement **financial rate‑limiting layer** for payment tools:
    - Per‑session, per‑patient, and per‑day dollar limits.
    - Hard caps on number of payment intents / transfers that can be created via a single voice/chat session.
    - Alerting and blocking behavior when limits are exceeded.
83. Document and design **Circle on/off‑ramp and fiat conversion strategy**:
    - How USDC enters the system (who funds wallets; via which bank/rail).
    - How and when USDC is converted to fiat and paid out to providers/insurers.
    - Which entity is responsible for bank‑side compliance and reporting.
84. Implement alert routing and on‑call integration for critical financial and PHI alerts:
    - Define who gets paged for which classes of incidents.
    - Integrate with PagerDuty/OpsGenie (or equivalent) and link alerts to the runbooks from task 75.
85. Define an initial **failover and recovery strategy** for the primary database and key services:
    - RPO/RTO targets for financial data.
    - Whether multi‑region or hot‑standby replicas are used.
    - What happens to in‑flight payment flows during failover, and how to safely resume or reconcile them afterward.

### C13. Tax reporting and weight‑change auditability

86. Implement **provider earnings and tax reporting support** alongside Stripe Connect Express:
    - Track annual earnings per provider in the ledger so Stripe’s 1099‑K reporting can be reconciled.
    - Surface thresholds (e.g., \$600) and account status in provider dashboards and admin tools.
87. Add an **audit log for outcome‑based matching weight changes**:
    - Log who changed cost‑builder weights/penalties, when, old vs new values, and what outcome data was used to justify the change.
    - Make this history queryable for internal review and potential regulators/ethics boards.

---

## Part D — UX & Journeys Backlog

> Cross‑persona user journeys, high‑stakes screens, and UX quality bars (including accessibility and mobile‑first).

### D1. Cross‑persona journeys & empty states

UX‑1. Define end‑to‑end **provider onboarding journey**: invite/signup → credentialing → availability setup → Stripe Connect → first visit → payouts.  
UX‑2. Define end‑to‑end **patient journey**: first visit → consent → booking → matching → visit → payments → follow‑up surveys.  
UX‑3. Define end‑to‑end **admin journey**: clinic onboarding → configuring prompts/voice agent → monitoring → resolving incidents/disputes.  
UX‑4. Design **empty states** for provider, patient, and admin dashboards with guidance and primary CTAs.

### D2. Provider UX improvements

UX‑5. Redesign **match Accept/Decline** as a mobile‑first notification flow with single‑tap Accept and a secondary Decline path (with optional structured reason), instead of a dashboard‑only modal.  
UX‑6. Make the **cognitive load indicator** actionable: when “Heavy”, offer options to temporarily reduce incoming matches, block new bookings for the day, or contact support.  
UX‑7. Define **SOAP note sign‑off UX**:
  - Show LLM‑generated note vs provider‑edited version.
  - Add explicit “I have reviewed and approve this note” confirmation separate from Save.
  - Provide diff view of edits and store version history for liability/audit.  
UX‑8. Implement **Stripe Connect state‑aware UI** with state‑specific CTAs and help for “not started”, “pending identity”, “pending bank”, “restricted”, “active”, and “deactivated”.

### D3. Patient UX improvements

UX‑9. Specify **booking + waiting experience**:
  - ETA and progress messaging during “Finding a provider…”.
  - Clear explanation of what happens next and maximum expected wait.
  - Fallback behavior and messaging if no match is found within X minutes.  
UX‑10. Design **emergency egress safety screen**:
  - Prominent crisis hotline numbers and “Call 911” option.
  - Ability to continue or safely exit; no trapping states.
  - Copy/layout aligned with mental‑health safety best practices.  
UX‑11. Design **research consent UX**:
  - Plain‑language summary plus expandable full legal text.
  - Per‑data‑use acknowledgments (research, product improvement, etc.).
  - Confirmation receipt sent to patient and stored via Consent Service (C11).  
UX‑12. Define **patient financial timeline language**: use patient‑friendly labels like “What your insurance covered”, “What you owe”, “What you’ve paid”, “What’s in review” instead of claims jargon.

### D4. Admin / Ops UX improvements

UX‑13. Design **prompt sandbox UX**:
  - Simulate different patient personas and scripted scenarios (e.g., suicidal ideation, no‑show, complex billing).
  - Side‑by‑side comparison of two prompt versions.
  - Logging of test runs (who tested what, when, with which prompt version).  
UX‑14. Add **semantics to monitoring dashboard**:
  - Thresholds and color‑coding (normal / warning / critical) per metric.
  - Short explanations and recommended actions for each critical state.  
UX‑15. Extend **HIPAA access log viewer** with CSV/PDF export of filtered results for audits.  
UX‑16. Design **reasoning audit view** as a compliance surface:
  - Show what the LLM concluded, what data it used, what alternatives it considered, and final choice.
  - Show who reviewed or overrode the decision and when.  
UX‑17. Build **notification preferences center** where patients and providers control channels (email/SMS/push/voice) and topics, respecting HIPAA constraints on message content.

### D5. Error, loading, accessibility, mobile

UX‑18. Create a catalog and designs for critical **error states**:
  - Insurance verification failure, payment failure, payout dispute, claim submission error, matching timeout, etc.
  - For each, define patient/provider messaging, next steps, and escalation options.  
UX‑19. Define **async loading and progress patterns**:
  - Standard progress/feedback for long‑running operations (matching, eligibility, claims, payments).
  - “You can leave this screen, we’ll notify you” pattern where safe.  
UX‑20. Establish **accessibility baseline (WCAG 2.1 AA)** across all major flows:
  - Typography, contrast, focus states, keyboard navigation, screen‑reader behavior.
  - Add accessibility checks to UI reviews and automated tests where feasible.  
UX‑21. Create **mobile‑first layout specs** for key flows:
  - Booking, waiting, visit join, payments, consent, emergency egress, provider Accept/Decline.
  - Define breakpoints, bottom‑sheet patterns, and tap targets.

### D6. Prioritized high‑stakes flows

UX‑22. Produce detailed UX specs (copy, states, mobile/desktop) for the five highest‑impact flows:
  1) Patient booking + waiting  
  2) Provider accept/decline  
  3) Emergency egress  
  4) SOAP note sign‑off  
  5) Patient financial timeline  
UX‑23. Align the **design system** (components, patterns) with these high‑stakes flows so the same buttons, alerts, banners, timelines, and modals can be reused across personas.

---

## Part E — Cash‑Only Telehealth at $1B Scale

> Focused tasks to ensure cash‑only telemedicine (patient → provider via Stripe), matching, and voice transcription can realistically support \$1B+/year (~10M visits).

### E1. Core cash rail (patient → provider via Stripe)

CF‑1. Finalize **cash‑only payment rail spec** (Stripe‑only): document end‑to‑end flow (checkout → payment intent → confirmation → Connect payout) with states, errors, and retry behavior.  
CF‑2. Implement double‑entry **ledger integration for Stripe payments**: ensure every charge/refund maps to patient/provider ledger entries with idempotency keys.  
CF‑3. Implement **Stripe Connect payouts driven by ledger**: use provider ledger balances to trigger Connect transfers when `consult_sessions` move to `complete`, with idempotent triggers and safe rollback rules.  
CF‑4. Build **patient and provider cash “wallet” views** backed solely by ledger balances and entries (no direct Stripe/Circle table reads).  
CF‑5. Implement **financial reconciliation jobs for Stripe**: periodic jobs that reconcile Stripe charges/payouts vs ledger entries and flag discrepancies.

### E2. Matching & optimization for telemedicine scale

MATCH‑1. Complete **practitioner and slot data model**: finish and validate `practitioners`, `practitioner_licenses`, `provider_slots`, and `consult_sessions` schemas and indexes for high‑volume matching.  
MATCH‑2. Implement **availability rules → slots indexer**: background job that expands availability rules into `provider_slots` for N days ahead, and supports incremental updates.  
MATCH‑3. Implement **cost‑based matching engine** (cost‑builder + greedy/Hungarian solver) using wait time, specialty fit, license, provider load, and penalties.  
MATCH‑4. Implement **match request/status APIs** (`POST /api/matching/request`, `GET /api/matching/status`, `POST /api/matching/cancel`) shared by voice and app.  
MATCH‑5. Wire **Retell voice and patient app to matching**: update Retell tools and patient app flows so they create `match_requests` and consume `match_assignments` / `consult_sessions` instead of direct, ad‑hoc bookings.  
MATCH‑6. Implement **surge pricing and monitoring** for matching cells, wired into visit pricing and exposed in monitoring dashboards.

### E3. Clinical safety & robustness at high volume

SAFE‑1. Implement **emergency egress** from matching: use transcript‑derived risk signals to bypass matching and trigger warm handoff / emergency flows, logging all decisions.  
SAFE‑2. Implement **cognitive load balancing**: track high‑intensity encounters per provider and dynamically adjust cost‑builder weights to prevent burnout under load.  
SAFE‑3. Implement **reasoning audit trail for matches**: persist clinical cues, cost breakdowns, alternatives considered, and final assignment, tied to users and review actions.

### E4. Algorithm performance, batching, and slot freshness

SCALE‑ALG‑1. Add **batch size limits and Hungarian performance profiling**:
  - Cap batch sizes to safe thresholds (e.g., max N match_requests per batch).  
  - Measure and optimize Hungarian runtime under realistic loads (thousands of requests).  
  - Introduce dynamic batch interval or split‑batch strategies under load.  
SCALE‑ALG‑2. Replace nightly‑only slot indexing with **near‑real‑time slot updates**:
  - Trigger slot updates on booking/cancellation and availability changes.  
  - Ensure `provider_slots` reflects up‑to‑date capacity throughout the day to avoid overbooking.  

### E5. Infra, DB, and capacity planning

SCALE‑1. Migrate **matching + payments** to Postgres/Cockroach: move high‑write tables (consult_sessions, providers, ledger, claims) off SQLite with proper transactions and replication.  
SCALE‑2. Index and tune **hot queries** for matching and payments (match queue, slot lookup, ledger by account/date, session lookups).  
SCALE‑3. Implement **background workers and queues** for matching batches, reconciliation, payouts, and high‑latency external calls (Stedi/FHIR/Stripe).  
SCALE‑4. Run **load tests** for matching + payments at target scale (tens of thousands of daily bookings; thousands of concurrent visits) and tune configuration.  
SCALE‑5. Perform **LiveKit capacity planning and alerting**:
  - Verify plan and limits for ~2k+ concurrent rooms.  
  - Add dashboards and alerts for LiveKit room count, bandwidth, and error rates.  

### E6. LLM pipeline cost and throughput control

LLM‑1. Design **LLM workload queuing** for SOAP notes and clinical cue extraction so post‑session processing is fully async and back‑pressure aware.  
LLM‑2. Implement **aggregate LLM cost controls**:
  - Project daily/monthly token and cost budgets based on 10M annual visits.  
  - Add system‑level caps and alerts when approaching LLM budget limits.  
LLM‑3. Monitor and optimize **LLM throughput** for post‑session tasks (e.g., target sustained N LLM calls/sec with graceful degradation if exceeded).

### E7. Transcript storage and archival

TRANS‑1. Perform **transcript storage capacity planning** for voice + video transcripts at projected visit volume; estimate data growth and required storage classes.  
TRANS‑2. Implement **tiered storage / archival strategy**:
  - Keep recent transcripts in fast storage for operational use.  
  - Move older transcripts to cheaper archival storage while preserving compliance and discoverability.  

### E8. Outcome‑based matching optimization

MATCH‑OPT‑1. Implement **outcome‑based matching weight optimization**:
  - Use longitudinal outcomes (e.g., PHQ‑9/GAD‑7 improvement, satisfaction scores) to evaluate matching quality.  
  - Periodically adjust cost‑builder weights and penalties based on empirical outcomes, with audit logs of changes.  
MATCH‑OPT‑2. Implement a **provider reliability / ghosting penalty**:
  - Maintain a reliability score per provider based on no‑shows, late joins, early drops, and cancellations.
  - Feed this score into the cost‑builder so frequently ghosting providers are only selected as a last resort or are temporarily excluded.

### E9. UX for cash + matching flows (high‑stakes)

UX‑CASH‑1. Design **patient booking + waiting journey** (mobile‑first) with clear expectations, ETA, and fallback behavior.  
UX‑CASH‑2. Design **provider accept/decline flow** optimized for mobile notification use, integrated with the matching engine.  
UX‑CASH‑3. Design **patient financial timeline** specifically for cash‑only flows, using plain‑language labels and surfacing payments, refunds, and outstanding balances.  
UX‑CASH‑4. Design **provider earnings and payout view** tied to ledger and Stripe Connect states, showing per‑visit and aggregate earnings and payout status.

### E10. Matching performance, sharding, and supply‑side incentives

SCALE‑ALG‑3. Implement **concrete batch capping and sharding for Hungarian**:
  - Define a maximum safe batch size (e.g., up to a few hundred pairs) based on profiling.  
  - Shard oversized batches by specialty, geography, or time window before building matrices.  
  - If a shard still exceeds the cap, split it into sub‑batches within the same 3‑minute cycle.  
MATCH‑INCENT‑1. Implement **provider supply‑side surge incentives**:
  - When wait times or unmatched demand in a matching cell exceed thresholds, increase per‑visit provider payouts (within legal/contractual bounds) via the ledger.  
  - Surface active multipliers and incentives clearly in provider dashboards to attract more log‑ins when needed.





---

<a id="periodic-maintenance"></a>

## Periodic maintenance (quarterly suggested)


Use this checklist to keep **documentation** and **CI expectations** aligned as the repo evolves.

## Review

- [ ] Root **`README.md`** feature bullets still match what CI and product actually enforce.
- [ ] **`CONTRIBUTING.md`** commands still match **`.github/workflows/ci.yml`**.
- [ ] **`openapi.yaml`** still reflects important public routes (spot-check after large refactors).
- [ ] **`docs/architecture/README.md#commerce-agentic-checkout-file-map`** if checkout or public commerce routes moved.
- [ ] Todos under **`todos/`** — close or update stale “done” narratives.

## Optional

- [ ] Dependency major upgrades (Node LTS, Expo SDK) — run full local + CI matrix before merging.


---

<a id="server-js-refactor-policy"></a>

## `server.js` — incremental refactor policy



`middleware-platform/server.js` is the Express **compose entry** (~11k lines after phase 6+ extraction). Patient/public Kelly triage, checkout-chat, profile/auth/documents/wallet/insurance, admin dashboard API, and voice scheduling HTTP live in **`routes/`** + **`services/`** — see [`SERVER_DECOMPOSITION.md`](../architecture/SERVER_DECOMPOSITION.md) and [`RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md`](../architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md).

## Rules for new work

1. **Prefer new HTTP handlers in `middleware-platform/routes/*.js`** and mount with `app.use('/api/...', router)` (or equivalent) from `server.js`.
2. **Business logic** belongs in `services/` (and `adapters/` for third parties), not inline in `server.js`.
3. **Do not** add new patient or public API handlers inline in `server.js`; use the route modules above.
4. **Touching `server.js` for a small change** is acceptable when moving code out would balloon the PR; follow up with extraction when practical.

## Review expectation

PRs that **add hundreds of lines** to `server.js` should either split into a route module or include a short note explaining why not (hotfix, etc.).

## Long-term

Reduce file size over time by moving **one route group at a time** to `routes/`, keeping behavior identical and tests/CI green.


---

<a id="structured-logging-future"></a>

## Structured logging (future)



Today **`KellyAgentService`** / **LLMRouter** use `console.warn` / `console.error` and opt-in debug flags (`KELLY_DEBUG`, etc.).

## Direction

For production observability, consider:

- A single **structured logger** (e.g. **pino** with JSON lines) behind a thin wrapper.
- **Correlation IDs** per HTTP request and LLM session, passed into tool execution.
- Redaction of **PII** and tokens at log boundaries.

No change is required for local development; this is a **future consolidation** when operational requirements justify the dependency and migration effort.


---

<a id="templates"></a>

## Automation Template Variables



This document lists all available template variables for use in automation email and SMS templates.

## Usage

Variables are enclosed in double curly braces: `{{variable_name}}`

Example:
```
Hello {{customer_name}}, your order {{order_id}} for ${{order_total}} has been completed!
```

## Available Variables

### Customer Variables

- **`{{customer_name}}`** - Customer's full name (falls back to email if name not available)
- **`{{customer_email}}`** - Customer's email address
- **`{{customer_phone}}`** - Customer's phone number

### Order Variables

- **`{{order_id}}`** - Order or checkout ID
- **`{{order_total}}`** - Total amount of the order (as a number, e.g., "50.00")
- **`{{order_status}}`** - Current status of the order (e.g., "completed", "pending", "cancelled")

### Merchant Variables

- **`{{merchant_name}}`** - Business/merchant name (defaults to "Your Business" if not available)
- **`{{merchant_email}}`** - Merchant's email address

## Context-Specific Variables

Additional variables may be available depending on the trigger context:

### Order Completed Trigger

When triggered by `order_completed`, the following context is available:
- `customer` - Full customer object
- `order` - Order object with all order details
- `checkout` - Checkout object

### Customer Created Trigger

When triggered by `customer_created`, the following context is available:
- `customer` - Full customer object

## Template Examples

### Order Confirmation Email

**Subject:** Order {{order_id}} Confirmation

**Body:**
```
Hi {{customer_name}}, Thank you for your order {{order_id}} for ${{order_total}}. Thanks, {{merchant_name}}
```

### Custom Variables

Pass custom variables via `context.variables` when calling `AutomationService.checkAndExecuteRules()` to use `{{custom_field}}` in templates.

## Notes

- Variables are case-sensitive: use `{{customer_name}}` not `{{Customer_Name}}`
- If a variable is not available, it will be replaced with an empty string
- All variables are automatically escaped for HTML/email safety
- For SMS templates, only the `content` field is used (no `subject` field)



## Consolidated: CODE_OWNERSHIP_BY_SURFACE.md


# Code Ownership By Surface


## Runtime Surfaces

- **API Host / routing composition**
  - Owner files: `middleware-platform/server.js`, `middleware-platform/routes/*`
  - Responsibilities: route mounting, middleware order, endpoint composition

- **Business/service orchestration**
  - Owner files: `middleware-platform/services/*`
  - Responsibilities: domain logic, state transitions, integration orchestration

- **Landing web UX**
  - Owner files: `unified-dashboard/somo-landing/src/*` (marketing); `_archive/littlelab-landing/src/*` (legacy)
  - Responsibilities: user flows, API calling patterns, presentation state

- **Patient app UX**
  - Owner files: `patient-app/app/*`, `patient-app/src/*`
  - Responsibilities: mobile session UX, patient journey screens, API clients

- **Operational automation**
  - Owner files: `scripts/*`, `middleware-platform/scripts/*`
  - Responsibilities: checks, migrations, diagnostics, release verification

## High-Risk Change Areas

- `middleware-platform/server.js` route/middleware order
- payment + webhook reconciliation (`routes/payment.js`, webhook handlers, payment services)
- reasoning and snapshot contracts (`services/reasoning-*`, `services/session-*`)
- public plan/geo/coverage contract paths (`routes/public-plan-search.js`, `routes/public-geo.js`)
- payor canonicalization + precheck (`services/payor-*`, `services/provider-network-*`)

## Required Documentation Update Rule

When adding or materially changing:
- a route file in `middleware-platform/routes/`, or
- a service file in `middleware-platform/services/`,

update at least one of:
- `docs/middleware-platform/README.md` (ownership tables/maps)
- `docs/meta/README.md#codebase-batch-review-and-documentation-gaps` (gap closure tracker)

CI doc parity check is enforced by `scripts/check-docs-route-service-parity.cjs`.



## Consolidated: SCRIPTS_OPERATIONS_MAP.md


# Scripts Operations Map


## Purpose

Map operational scripts to safe usage level so engineers can run the right checks without accidental production-impacting actions.

## Tiers

- **Tier A (safe/read-only checks)**
  - verification/report scripts
  - examples: `scripts/check-*.mjs`, `scripts/report-*.cjs`, `verify:*` npm scripts

- **Tier B (controlled write to local/test state)**
  - local migrations, local seeders, local replay scripts
  - requires explicit `DB_PATH` and environment awareness

- **Tier C (external side effects / prod-adjacent)**
  - deployment scripts, remote mutation scripts, credential/domain setup scripts
  - should run only with owner approval and change tracking

## Script Families

- **Root scripts (`scripts/`)**
  - deployment and environment setup
  - UI/API smoke checks
  - docs and guardrail checks

- **Middleware scripts (`middleware-platform/scripts/`)**
  - payor pipeline, readiness, observability
  - reasoning gates and E2E checks
  - payment/ops diagnostics and recovery tasks

## Required Script Execution Notes

- Always set/verify `DB_PATH` before stateful middleware scripts.
- Prefer dry-run flags where available.
- Capture outputs for audit when running Tier C scripts.
- Link operational outcomes back to `docs/runbooks/` or `todos/` tracking items.
