# Architecture Issues Analysis

**Date**: January 27, 2025  
**Status**: Critical issues identified that prevent proper multi-tenancy

---

## 🚨 Critical Issues

### 1. **Hardcoded Tenant References**

**Problem**: The system has hardcoded references to `'akin-dunbar'` throughout the codebase.

**Locations**:
- `middleware-platform/routes/voice.js` (lines 56-67)
- `middleware-platform/services/payment-orchestrator.js` (lines 47-59)
- `middleware-platform/server.js` (line 9706)
- `middleware-platform/routes/customer-agent.js` (line 30)

**Impact**:
- ❌ Cannot support multiple tenants properly
- ❌ All requests default to Tenant 1 (akin-dunbar)
- ❌ Tenant 2 will receive Tenant 1's data
- ❌ Breaks data isolation

**Example**:
```javascript
// BAD: Hardcoded fallback
const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');
```

**Fix Required**: Remove all hardcoded references, use dynamic tenant resolution.

---

### 2. **Confusing Entity Model (Customers vs Clinics vs Merchants)**

**Problem**: Three separate entity types with unclear relationships:

- **`customers`** - API/SaaS users (from signup)
- **`clinics`** - Medical clinics (tenants)
- **`merchants`** - E-commerce shops (legacy?)

**Issues**:
- ❌ No clear relationship between them
- ❌ `clinics` has `merchant_id` field (why?)
- ❌ `customers` has `retell_agent_id` (should be on `clinics`)
- ❌ Voice calls use `customer_id` but should use `clinic_id`
- ❌ Payment requests use `merchant_id` but clinics should use `clinic_id`

**Current State**:
```
customers (API users)
  └─ retell_agent_id ❌ (wrong - should be on clinics)

clinics (medical tenants)
  └─ merchant_id ❌ (confusing - why link to merchant?)

merchants (e-commerce shops)
  └─ subdomain (used for routing)
```

**Fix Required**: 
- Clarify entity relationships
- Decide: Is this a medical SaaS (clinics) or e-commerce (merchants)?
- Unify tenant identification

---

### 3. **No Automatic Tenant Provisioning**

**Problem**: Signup creates `customer` but NOT `clinic` (tenant).

**Current Flow**:
```
User signs up → Creates `customer` record
  ❌ No clinic created
  ❌ No Retell agent provisioned
  ❌ No phone number assigned
  ❌ No tenant isolation
```

**Impact**:
- ❌ New signups can't use the system
- ❌ Manual intervention required for each tenant
- ❌ Not scalable

**Fix Required**: 
- Auto-create clinic on signup (for SaaS customers)
- Auto-provision Retell agent
- Auto-assign phone number

---

### 4. **Inconsistent Tenant Identification**

**Problem**: Multiple ways to identify tenants, no single source of truth.

**Methods Used**:
1. **Subdomain** (`akin-dunbar.doclittle.site`) → `merchant.subdomain`
2. **Merchant ID** → `merchant_id` in requests
3. **Clinic ID** → `clinic_id` in database
4. **Phone Number** → `clinic_phone_numbers` lookup
5. **Customer ID** → `customer_id` in voice calls (WRONG)

**Issues**:
- ❌ Voice calls use `customer_id` but should use `clinic_id`
- ❌ Payment requests use `merchant_id` but clinics use `clinic_id`
- ❌ No consistent mapping between these IDs

**Example**:
```javascript
// Voice call uses customer_id (WRONG)
connection.customer_id = message.call.dynamic_variables.clinic_id;

// But should use clinic_id consistently
connection.clinic_id = message.call.dynamic_variables.clinic_id;
```

**Fix Required**: 
- Standardize on `clinic_id` as primary tenant identifier
- Create mapping table if needed
- Update all references

---

### 5. **Dangerous Fallback Logic**

**Problem**: When tenant can't be identified, system falls back to hardcoded tenant or first merchant.

**Locations**:
- `middleware-platform/routes/voice.js` (lines 52-72)
- `middleware-platform/services/payment-orchestrator.js` (lines 42-65)

**Code**:
```javascript
// BAD: Falls back to hardcoded tenant
if (!merchant) {
    const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');
    // OR
    const preferredMerchant = allMerchants.find(m => m.subdomain === 'akin-dunbar') || allMerchants[0];
}
```

**Impact**:
- ❌ Tenant 2's requests could route to Tenant 1
- ❌ Data leakage between tenants
- ❌ Security risk (HIPAA violation if medical data)

**Fix Required**: 
- Remove fallback logic
- Return error if tenant can't be identified
- Require explicit tenant identification

---

### 6. **Mixed Data Models**

**Problem**: Some tables use `clinic_id`, others use `merchant_id`, others use `customer_id`.

**Tables with `clinic_id`**:
- ✅ `clinics`
- ✅ `appointments`
- ✅ `clinic_phone_numbers`
- ✅ `voice_checkouts` (has both `clinic_id` AND `merchant_id`)

**Tables with `merchant_id`**:
- ✅ `merchants`
- ✅ `products`
- ✅ `transactions`
- ✅ `voice_checkouts` (has both!)

**Tables with `customer_id`**:
- ✅ `customers`
- ✅ `voice_call_log` (WRONG - should be `clinic_id`)
- ✅ `api_usage_log`
- ✅ `function_call_log`

**Issues**:
- ❌ `voice_checkouts` has BOTH `clinic_id` AND `merchant_id` (which one?)
- ❌ `voice_call_log` uses `customer_id` but should use `clinic_id`
- ❌ No clear pattern

**Fix Required**: 
- Decide: Use `clinic_id` for all tenant-scoped data
- Migrate `voice_call_log.customer_id` → `clinic_id`
- Remove `merchant_id` from `voice_checkouts` (or clarify relationship)

---

### 7. **No Tenant Context Middleware**

**Problem**: No middleware to extract and validate tenant context from requests.

**Current State**:
- Each route manually extracts tenant
- Inconsistent methods (subdomain, merchant_id, clinic_id)
- No validation
- No error handling

**What's Missing**:
```javascript
// Should have:
app.use(tenantContextMiddleware);

// That extracts:
req.tenant = {
  clinic_id: 'clinic-xxx',
  clinic: { ... },
  validated: true
};
```

**Fix Required**: 
- Create `tenantContextMiddleware`
- Extract tenant from subdomain, phone number, or explicit ID
- Validate tenant exists and is active
- Add to `req.tenant` for all routes

---

### 8. **Voice Call Routing Issues**

**Problem**: Voice calls identify tenant inconsistently.

**Current Flow**:
1. Call comes in → Twilio webhook
2. Look up by phone number → `clinic_phone_numbers`
3. Extract `clinic_id` → Store in `connection.customer_id` (WRONG NAME)
4. Use `customer_id` for billing (WRONG - should be `clinic_id`)

**Issues**:
- ❌ Uses `customer_id` field name but stores `clinic_id` value
- ❌ Confusing naming
- ❌ Billing uses wrong field

**Code**:
```javascript
// BAD: Stores clinic_id in customer_id field
connection.customer_id = clinicPhone.clinic_id;

// Later: Uses customer_id for billing (confusing)
const credits = db.getCustomerCredits(connection.customer_id);
```

**Fix Required**: 
- Rename `connection.customer_id` → `connection.clinic_id`
- Update all references
- Fix billing to use `clinic_id`

---

### 9. **Subdomain Routing Only Works for Merchants**

**Problem**: Subdomain routing looks up `merchants` table, not `clinics`.

**Code** (`server.js` line 391):
```javascript
const merchant = db.getMerchantBySubdomain(subdomain);
```

**Issues**:
- ❌ Clinics have `slug` field but routing uses `merchant.subdomain`
- ❌ No way to route `clinic.doclittle.site` to a clinic
- ❌ Only works for merchants

**Fix Required**: 
- Add `getClinicBySlug()` lookup
- Route subdomains to clinics OR merchants
- Support both entity types

---

### 10. **No Tenant Isolation Enforcement**

**Problem**: No middleware or service layer enforces tenant isolation.

**What's Missing**:
- ❌ No automatic `WHERE clinic_id = ?` filtering
- ❌ No validation that user belongs to tenant
- ❌ No row-level security
- ❌ Queries can return data from wrong tenant

**Example**:
```javascript
// BAD: No tenant filtering
const appointments = db.getAppointments(); // Returns ALL appointments

// GOOD: Should be
const appointments = db.getAppointmentsByClinic(clinic_id);
```

**Fix Required**: 
- Add tenant filtering to all queries
- Create service layer that enforces isolation
- Add validation middleware

---

## 📊 Summary: What's Broken

| Issue | Severity | Impact |
|-------|----------|--------|
| Hardcoded tenant references | 🔴 Critical | Breaks multi-tenancy |
| Confusing entity model | 🔴 Critical | Unclear architecture |
| No auto-provisioning | 🟠 High | Not scalable |
| Inconsistent tenant ID | 🔴 Critical | Data leakage risk |
| Dangerous fallbacks | 🔴 Critical | Security risk |
| Mixed data models | 🟠 High | Confusing codebase |
| No tenant middleware | 🟠 High | Inconsistent behavior |
| Voice routing issues | 🟠 High | Billing errors |
| Subdomain routing | 🟡 Medium | Limited functionality |
| No isolation enforcement | 🔴 Critical | Data leakage |

---

## 🎯 Root Cause

**The system was built for single-tenant (akin-dunbar) and then retrofitted for multi-tenancy without proper refactoring.**

**Evidence**:
1. Hardcoded `'akin-dunbar'` everywhere
2. Fallback to first merchant/tenant
3. Mixed entity models (customers/clinics/merchants)
4. No tenant context middleware
5. Inconsistent ID usage

---

## ✅ What Needs to Happen

### Phase 1: Critical Fixes (Week 1)

1. **Remove all hardcoded tenant references**
   - Replace with dynamic tenant resolution
   - Remove fallback logic

2. **Standardize on `clinic_id`**
   - Use `clinic_id` as primary tenant identifier
   - Update all tables and queries
   - Rename `customer_id` → `clinic_id` in voice calls

3. **Create tenant context middleware**
   - Extract tenant from request
   - Validate tenant exists
   - Add to `req.tenant`

4. **Fix voice call routing**
   - Use `clinic_id` consistently
   - Fix billing to use `clinic_id`

### Phase 2: Architecture Cleanup (Week 2)

5. **Clarify entity relationships**
   - Document: customers vs clinics vs merchants
   - Decide on single entity model
   - Update database schema

6. **Add tenant isolation**
   - Service layer with automatic filtering
   - Validation middleware
   - Row-level security

7. **Fix subdomain routing**
   - Support both clinics and merchants
   - Use `slug` for clinics

### Phase 3: Auto-Provisioning (Week 3)

8. **Auto-create clinic on signup**
   - For SaaS customers, create clinic
   - Provision Retell agent
   - Assign phone number

9. **Add tenant management API**
   - CRUD endpoints for clinics
   - Onboarding service
   - Admin dashboard

---

## 🔧 Quick Wins (Do First)

1. **Create constants file** - Replace `'akin-dunbar'` with constant
2. **Add tenant context middleware** - Extract tenant once, use everywhere
3. **Fix voice call `customer_id`** - Rename to `clinic_id`
4. **Remove fallback logic** - Return error instead of guessing tenant

---

## 📝 Related Documents

- **Onboarding Checklist**: `docs/onboarding/CLINIC_ONBOARDING_CHECKLIST.md`
- **Multi-Tenant Architecture**: `docs/architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md`
- **Database Schema**: `docs/architecture/database/DATABASE_SCHEMA_APPROACH.md`

---

**Last Updated**: January 27, 2025  
**Priority**: 🔴 Critical - Fix before onboarding Tenant 2

