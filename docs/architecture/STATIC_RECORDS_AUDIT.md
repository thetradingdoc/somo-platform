# Static Records Audit

This document lists all hardcoded/static records found in the codebase (frontend and backend, including admin).

## 🔴 CRITICAL: Hardcoded Merchant ID

**Location**: Multiple files  
**Issue**: Hardcoded merchant ID `d10794ff-ca11-4e6f-93e9-560162b4f884` used as fallback

### Backend Files:

1. **`middleware-platform/server.js`** (Line 1210)
   ```javascript
   merchant_id: process.env.MERCHANT_ID || 'd10794ff-ca11-4e6f-93e9-560162b4f884'
   ```

2. **`middleware-platform/server.js`** (Line 1373)
   ```javascript
   merchant_id: process.env.MERCHANT_ID || 'd10794ff-ca11-4e6f-93e9-560162b4f884'
   ```

3. **`middleware-platform/server.js`** (Line 1669)
   ```javascript
   const merchantId = args.merchant_id || 'd10794ff-ca11-4e6f-93e9-560162b4f884';
   ```

4. **`middleware-platform/server.js`** (Line 1672-1681)
   ```javascript
   // Creates default merchant with hardcoded values
   db.createMerchant({
     id: merchantId,
     name: 'DocLittle Default Merchant',
     api_key: 'default-api-key',
     api_url: 'https://api.example.com',
     webhook_url: null,
     enabled_platforms: JSON.stringify(['voice']),
     status: 'active'
   });
   ```

5. **`middleware-platform/server.js`** (Line 3253)
   ```javascript
   merchant_id: 'd10794ff-ca11-4e6f-93e9-560162b4f884',
   ```

6. **`middleware-platform/webhooks/retell-websocket.js`** (Line 519)
   ```javascript
   merchant_id: functionArgs.merchant_id || 'd10794ff-ca11-4e6f-93e9-560162b4f884',
   ```

7. **`middleware-platform/webhooks/retell-websocket.js`** (Line 555)
   ```javascript
   merchant_id: 'd10794ff-ca11-4e6f-93e9-560162b4f884',
   ```

8. **`middleware-platform/webhooks/retell-websocket.js`** (Line 692)
   ```javascript
   let merchantId = functionArgs.merchant_id || 'd10794ff-ca11-4e6f-93e9-560162b4f884';
   ```

9. **`middleware-platform/webhooks/retell-websocket.js`** (Line 806)
   ```javascript
   let merchantId = 'd10794ff-ca11-4e6f-93e9-560162b4f884';
   ```

**Recommendation**: 
- Remove all hardcoded merchant IDs
- Use tenant context middleware to resolve merchant
- Return error if merchant cannot be determined (no fallback)

---

## 🟡 MEDIUM: Hardcoded Default Subdomain

**Location**: `middleware-platform/utils/constants.js` (Line 10)
```javascript
DEFAULT_SUBDOMAIN: process.env.DEFAULT_TENANT_SUBDOMAIN || 'akin-dunbar',
```

**Used in**: 
- `middleware-platform/routes/customer-agent.js` (getTenantType function)

**Recommendation**: 
- Mark as DEPRECATED (already done)
- Remove usage in favor of tenant resolution
- Keep only for backward compatibility during migration

---

## 🟡 MEDIUM: Hardcoded Test Patient Data

**Location**: `middleware-platform/server.js` (Lines 3690-3723)
```javascript
const testPatients = [
  {
    firstName: 'Sarah',
    lastName: 'Johnson',
    phone: '+18622307479',
    email: 'sarah.johnson@example.com',
    birthDate: '1985-05-20',
    memberId: 'TEST81941',
    payerId: 'AETNA',
    // ... more fields
  },
  {
    firstName: 'Michael',
    lastName: 'Williams',
    phone: '+15551234567',
    email: 'michael.williams@example.com',
    // ... more fields
  }
];
```

**Endpoint**: `POST /api/admin/patients/seed-test`

**Recommendation**: 
- Keep for testing/development
- Add environment check (only allow in dev/staging)
- Consider moving to separate seed script

---

## 🟢 LOW: Hardcoded Default States (Admin Dashboard)

**Location**: `unified-dashboard/admin/index.html` (Lines 1688-1691)
```javascript
window.selectedStates = [
  { value: 'US,NJ', text: 'New Jersey' },
  { value: 'US,NY', text: 'New York' }
];
```

**Purpose**: Default states for lead search in admin dashboard

**Recommendation**: 
- This is acceptable as UI default
- Consider making configurable via admin settings
- Not a data integrity issue

---

## 🟢 LOW: Mock Trend Data (Business Dashboard)

**Location**: `unified-dashboard/business/business-dashboard.html` (Lines 2314-2316)
```javascript
// Update trend indicators (mock data for now - can be calculated from historical data)
document.getElementById('revenueTrend').textContent = '+11%';
document.getElementById('aovTrend').textContent = '+2.7%';
```

**Recommendation**: 
- Replace with actual historical data calculation
- Low priority - UI enhancement

---

## Summary

### Critical Issues (Must Fix):
1. **Hardcoded Merchant ID** - 9 instances across backend
   - **Impact**: Multi-tenant isolation broken
   - **Priority**: HIGH
   - **Action**: Remove all fallbacks, use tenant context

### Medium Issues (Should Fix):
2. **Default Subdomain** - 1 instance (already deprecated)
   - **Impact**: Backward compatibility only
   - **Priority**: MEDIUM
   - **Action**: Remove after migration complete

3. **Test Patient Data** - 1 endpoint
   - **Impact**: Development/testing only
   - **Priority**: MEDIUM
   - **Action**: Add environment guard

### Low Issues (Nice to Have):
4. **Default States** - Admin UI default
   - **Impact**: None (UI convenience)
   - **Priority**: LOW

5. **Mock Trend Data** - Business dashboard
   - **Impact**: None (UI placeholder)
   - **Priority**: LOW

---

## Action Plan

1. **Phase 1 (Critical)**: Remove all hardcoded merchant ID fallbacks
   - Update `server.js` (5 instances)
   - Update `retell-websocket.js` (4 instances)
   - Ensure tenant context middleware is used everywhere
   - Test multi-tenant scenarios

2. **Phase 2 (Medium)**: Clean up deprecated defaults
   - Remove `DEFAULT_SUBDOMAIN` usage
   - Add environment guard to test patient seeding

3. **Phase 3 (Low)**: UI improvements
   - Replace mock trend data with real calculations
   - Make default states configurable

