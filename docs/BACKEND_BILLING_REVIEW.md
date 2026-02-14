# Backend Billing & Claims API Review

**Date:** 2026-01-30  
**Context:** UI navigation updated for practitioner journey (coding → claims → revenue).

## APIs Used by Frontend

### Billing Page (`billing.html`)

| Endpoint | Purpose | Scoping |
|----------|---------|---------|
| `GET /api/usage-monitor/credits` | Credit balance | ✅ Session (customer) |
| `GET /api/invoices` | List invoices | ⚠️ Check invoices-clinic |
| `GET /api/admin/billing/eob` | Claims/EOB list by patient | ❌ **No tenant filter** |
| `POST /api/pdf-coding/process` | Extract codes from PDF | ✅ Session |
| `GET /api/fhir/Patient` | Patient list for claim | ⚠️ FHIR - check scope |
| `POST /api/claims/create-from-pdf` | Create claim from scan | ✅ |
| `POST /api/invoices/create-from-claim` | Create invoice from claim | ✅ |

### Claims Page (`claims.html`)

| Endpoint | Purpose | Scoping |
|----------|---------|---------|
| `GET /api/claims/:id` | Claim details | ✅ |
| `POST /api/claims/:id/submit-payment` | Submit payment | ✅ |
| `POST /api/claims/:id/approve-payment` | Approve payment | ✅ |
| `POST /api/invoices/create-from-claim` | Create invoice | ✅ |

### PDF Coding (Scan section)

| Endpoint | Purpose | Scoping |
|----------|---------|---------|
| `POST /api/pdf-coding/process` | Extract ICD-10/CPT from PDF | ✅ |
| `POST /api/claims/create-from-pdf` | Create claim | ✅ |

---

## Findings

### 1. `/api/admin/billing/eob` – No tenant scoping

**Location:** `server.js` line 9339

**Issue:** Fetches `fhir_patients` without filtering by merchant_id or customer. In multi-tenant setups, practitioners could see other tenants' patient billing data.

**Recommendation:** Add customer-scoped endpoint, e.g. `GET /api/customer/billing/eob`, that:
- Uses `getCustomerFromSession(req)`
- Filters patients/claims by `customer.merchant_id` (or equivalent)
- Updates `billing.html` to call this endpoint instead

### 2. `/api/invoices` – Scope check needed

**Location:** `routes/invoices-clinic.js`

**Note:** Uses `db.getInvoices(filters)`. Confirm `getInvoices` applies merchant/customer scope. If not, add merchant_id filter from session.

### 3. `/api/fhir/Patient` – FHIR scope

**Note:** FHIR Patient is a global resource. If the app is multi-tenant, consider a wrapper that filters by merchant_id or ensure `fhir_patients` has a merchant_id column and filters accordingly.

### 4. Customer-scoped endpoints (working correctly)

- `GET /api/usage-monitor/credits` – uses session
- `POST /api/claims/create-from-pdf` – uses session
- `GET /api/claims/:id` – verify claim belongs to requester's merchant
- `POST /api/invoices/create-from-claim` – verify claim ownership

---

## Route Inventory

| Route prefix | Mount | Purpose |
|--------------|-------|---------|
| `/api/usage-monitor` | usage-monitor.js | Credits, billing, analytics |
| `/api/invoices` | invoices-clinic.js | Clinic patient invoices |
| `/api/claims/*` | server.js (inline) | Claim CRUD, create-from-pdf, payments |
| `/api/pdf-coding` | pdf-coding.js | PDF processing |
| `/api/customer/billing` | customer-billing.js | Usage, checkout (DocLittle billing) |
| `/api/admin/billing` | server.js | Billing summary, EOB list |

---

## Suggested Backend Changes (Future)

1. **Add `GET /api/customer/billing/eob`** – tenant-scoped EOB list; switch billing page to use it.
2. **Add tenant check to `GET /api/claims/:id`** – ensure claim belongs to requester's merchant.
3. **Verify `db.getInvoices()`** – confirm it filters by merchant_id when provided.
4. **Deprecate or scope `/api/admin/billing/eob`** – restrict to admin or add tenant filter.
