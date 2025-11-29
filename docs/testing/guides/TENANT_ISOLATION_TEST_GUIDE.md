# Tenant Isolation Test Guide

## Overview
This guide tests the tenant isolation system to ensure each customer only sees their own data.

## Test Flow

### 1. Signup Flow Test

**Test:** Create a new customer account and verify tenant ID

1. Navigate to `http://localhost:4000/signup`
2. Fill out the signup form:
   - Name: Test Customer 1
   - Email: test1@example.com
   - Phone: +1234567890
   - Company: Test Clinic 1
3. Complete email verification
4. Select integration type (SaaS or API)
5. Accept terms

**Expected Results:**
- Customer is created with unique ID: `cust_<uuid>`
- `customer_type` is saved correctly
- Session cookie `customer_session` is set
- Redirect to appropriate dashboard based on `customer_type`

**Verify in Database:**
```sql
SELECT id, name, email, customer_type, created_at 
FROM customers 
WHERE email = 'test1@example.com';
```

Should show:
- `id` starts with `cust_`
- `customer_type` matches selection
- `created_at` is recent

---

### 2. Login/Session Test

**Test:** Sign in and verify session isolation

1. Navigate to `http://localhost:4000/signin` (or use signup flow)
2. Enter email and verification code
3. Check browser cookies for `customer_session`

**Expected Results:**
- `customer_session` cookie is set
- Session links to correct `customer_id`
- Can access customer dashboard

**Verify Session:**
```sql
SELECT cs.id, cs.customer_id, c.name, c.email, cs.expires_at
FROM customer_sessions cs
JOIN customers c ON cs.customer_id = c.id
WHERE c.email = 'test1@example.com'
ORDER BY cs.created_at DESC
LIMIT 1;
```

---

### 3. Dashboard Data Isolation Test

**Test:** Verify dashboard shows only customer's data

1. Log in as Test Customer 1
2. Navigate to `http://localhost:4000/business/business-dashboard.html`
3. Check dashboard stats:
   - Total calls
   - Calls today
   - Revenue
   - Call costs

**Expected Results:**
- All stats show `0` for new customer (no data yet)
- No data from other customers appears
- API calls use `/api/customer/dashboard/*` endpoints

**Check Browser Console:**
- Open DevTools → Network tab
- Look for API calls:
  - `GET /api/customer/dashboard/stats`
  - `GET /api/customer/dashboard/calls`
  - `GET /api/customer/dashboard/appointments/upcoming`
- Verify all return `200 OK`
- Verify response contains only customer's data

---

### 4. API Endpoint Test

**Test:** Directly test customer-scoped endpoints

#### Test 4.1: Dashboard Stats
```bash
# Get customer session ID from browser cookies
curl -X GET "http://localhost:4000/api/customer/dashboard/stats" \
  -H "Cookie: customer_session=<SESSION_ID>" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "stats": {
    "total": { "calls": 0 },
    "today": { "calls": 0, "revenue": 0, "orders": 0 },
    "priority": { "cases": 0 },
    "costs": { "today": 0, "total": 0 }
  }
}
```

#### Test 4.2: Customer Appointments
```bash
curl -X GET "http://localhost:4000/api/customer/dashboard/appointments" \
  -H "Cookie: customer_session=<SESSION_ID>" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "appointments": [],
  "count": 0
}
```

#### Test 4.3: Customer Calls
```bash
curl -X GET "http://localhost:4000/api/customer/dashboard/calls" \
  -H "Cookie: customer_session=<SESSION_ID>" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "calls": [],
  "count": 0
}
```

#### Test 4.4: Without Session (Should Fail)
```bash
curl -X GET "http://localhost:4000/api/customer/dashboard/stats" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Unauthorized. Please sign in."
}
```

---

### 5. Multi-Tenant Isolation Test

**Test:** Verify data isolation between different customers

#### Step 1: Create Second Customer
1. Sign up as a new customer:
   - Email: `test2@example.com`
   - Name: Test Customer 2
   - Complete signup flow

#### Step 2: Create Test Data for Customer 1
```sql
-- Create a test appointment for customer 1
INSERT INTO appointments (
  id, customer_id, patient_name, patient_phone, patient_email,
  appointment_type, date, time, start_time, end_time,
  duration_minutes, provider, status
) VALUES (
  'apt_test1_001',
  (SELECT id FROM customers WHERE email = 'test1@example.com'),
  'John Doe',
  '+1234567890',
  'john@example.com',
  'Consultation',
  '2025-12-01',
  '10:00',
  '2025-12-01T10:00:00Z',
  '2025-12-01T10:50:00Z',
  50,
  'Dr. Smith',
  'scheduled'
);

-- Create a test call for customer 1
INSERT INTO voice_call_log (
  id, customer_id, call_id, call_duration_seconds, 
  call_duration_minutes, status, total_cost_usd
) VALUES (
  'call_test1_001',
  (SELECT id FROM customers WHERE email = 'test1@example.com'),
  'retell_call_001',
  180,
  3.0,
  'completed',
  0.25
);
```

#### Step 3: Create Test Data for Customer 2
```sql
-- Create a test appointment for customer 2
INSERT INTO appointments (
  id, customer_id, patient_name, patient_phone, patient_email,
  appointment_type, date, time, start_time, end_time,
  duration_minutes, provider, status
) VALUES (
  'apt_test2_001',
  (SELECT id FROM customers WHERE email = 'test2@example.com'),
  'Jane Smith',
  '+1987654321',
  'jane@example.com',
  'Therapy',
  '2025-12-02',
  '14:00',
  '2025-12-02T14:00:00Z',
  '2025-12-02T14:50:00Z',
  50,
  'Dr. Johnson',
  'scheduled'
);

-- Create a test call for customer 2
INSERT INTO voice_call_log (
  id, customer_id, call_id, call_duration_seconds, 
  call_duration_minutes, status, total_cost_usd
) VALUES (
  'call_test2_001',
  (SELECT id FROM customers WHERE email = 'test2@example.com'),
  'retell_call_002',
  240,
  4.0,
  'completed',
  0.33
);
```

#### Step 4: Verify Isolation
1. **Log in as Customer 1:**
   - Dashboard should show:
     - 1 appointment (John Doe)
     - 1 call (3 minutes, $0.25)
   - Should NOT see Customer 2's data

2. **Log in as Customer 2:**
   - Dashboard should show:
     - 1 appointment (Jane Smith)
     - 1 call (4 minutes, $0.33)
   - Should NOT see Customer 1's data

3. **Verify via API:**
   ```bash
   # As Customer 1
   curl -X GET "http://localhost:4000/api/customer/dashboard/appointments" \
     -H "Cookie: customer_session=<CUSTOMER1_SESSION>"
   
   # Should return only Customer 1's appointment
   
   # As Customer 2
   curl -X GET "http://localhost:4000/api/customer/dashboard/appointments" \
     -H "Cookie: customer_session=<CUSTOMER2_SESSION>"
   
   # Should return only Customer 2's appointment
   ```

---

### 6. Database Verification

**Verify Tenant Isolation in Database:**

```sql
-- Check all customers and their tenant IDs
SELECT id, name, email, customer_type, created_at 
FROM customers 
ORDER BY created_at DESC;

-- Check appointments are linked to customers
SELECT 
  a.id,
  a.customer_id,
  c.name as customer_name,
  a.patient_name,
  a.date,
  a.time
FROM appointments a
LEFT JOIN customers c ON a.customer_id = c.id
ORDER BY a.created_at DESC;

-- Check calls are linked to customers
SELECT 
  v.id,
  v.customer_id,
  c.name as customer_name,
  v.call_duration_minutes,
  v.total_cost_usd
FROM voice_call_log v
LEFT JOIN customers c ON v.customer_id = c.id
ORDER BY v.created_at DESC;

-- Verify no cross-tenant data leakage
-- This query should return 0 rows (no appointments without customer_id)
SELECT COUNT(*) as appointments_without_customer
FROM appointments
WHERE customer_id IS NULL AND clinic_id IS NOT NULL;
```

---

## Common Issues & Solutions

### Issue 1: Dashboard shows "Unauthorized"
**Solution:** 
- Check that `customer_session` cookie is set
- Verify session hasn't expired
- Check browser console for errors

### Issue 2: Dashboard shows all data (not tenant-scoped)
**Solution:**
- Verify dashboard is using `/api/customer/dashboard/*` endpoints
- Check browser Network tab to confirm correct endpoints
- Verify `getCustomerFromSession()` is working in API routes

### Issue 3: Appointments not showing
**Solution:**
- Verify `customer_id` is set when creating appointments
- Check database: `SELECT * FROM appointments WHERE customer_id = '<customer_id>'`
- Verify migration ran: `PRAGMA table_info(appointments);` should show `customer_id` column

### Issue 4: API returns 401 Unauthorized
**Solution:**
- Check session cookie is being sent with requests
- Verify `credentials: 'include'` is set in fetch calls
- Check session hasn't expired in database

---

## Success Criteria

✅ Each customer gets unique tenant ID (`cust_<uuid>`)  
✅ Sessions are correctly linked to customers  
✅ Dashboard shows only customer's own data  
✅ API endpoints return only customer's data  
✅ No data leakage between tenants  
✅ Appointments are linked to `customer_id`  
✅ Calls are linked to `customer_id`  
✅ Unauthorized access is blocked (401 errors)

---

## Next Steps After Testing

1. If all tests pass: ✅ Tenant isolation is working correctly
2. If tests fail: Review error messages and fix issues
3. Test with production-like data volumes
4. Monitor for performance issues with large datasets
5. Consider adding tenant-level caching if needed


