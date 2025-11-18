# Local Testing Guide

## Server Status
✅ Server is running at: `http://localhost:4000`
✅ Database: Using `middleware-dev.db` (development environment)

---

## Test 1: Session Check on Root Endpoint

### Test: Logged-in users should be redirected to `/docs`

**Steps:**
1. Open browser in **Incognito/Private mode**
2. Go to `http://localhost:4000`
3. **Expected:** See signup page (no session yet)

4. Complete signup flow:
   - Fill out signup form
   - Verify email with code
   - Accept terms
   - You should be redirected to `/docs`

5. After accepting terms, go back to `http://localhost:4000`
   - **Expected:** Should automatically redirect to `/docs`
   - **Not Expected:** Should NOT show signup page again

### Manual Test with cURL:
```bash
# Test 1: No session - should serve signup page
curl -I http://localhost:4000
# Should return 200 OK (HTML page)

# Test 2: With valid session cookie
# (After signing up, copy your session cookie from browser DevTools)
curl -I -H "Cookie: customer_session=YOUR_SESSION_ID" http://localhost:4000
# Should return 302 Redirect to /docs
```

---

## Test 2: Database Environment Separation

### Verify correct database is used:

**Check server logs** - Look for:
```
📁 Database path: /Users/jeremiahrichie/middleware-dev.db (environment: development)
```

**Verify database files:**
```bash
# Development database (should exist)
ls -lh ~/middleware-dev.db

# Production database (should NOT exist locally)
ls -lh ~/middleware-prod.db
# Should say: No such file
```

**Test Production Mode (Optional):**
```bash
# Stop current server (Ctrl+C)

# Start with production environment
cd middleware-platform
NODE_ENV=production npm start

# Check logs - should show:
# 📁 Database path: /Users/jeremiahrichie/middleware-prod.db (environment: production)
```

---

## Test 3: Full Signup Flow

1. **Visit:** `http://localhost:4000`
   - ✅ Should see signup form

2. **Fill out form:**
   - Name: Test User
   - Business Email: test@example.com
   - Phone: +15551234567
   - Company Name: Test Company
   - Business Size: Small
   - Use Case: Testing API

3. **Check email** for verification code (or check server logs)

4. **Verify email:**
   - Enter code
   - ✅ Should get session cookie
   - ✅ Should redirect to `/terms`

5. **Accept terms:**
   - ✅ Should allocate 100 free minutes
   - ✅ Should create Retell agent
   - ✅ Should redirect to `/docs`

6. **Visit root again:** `http://localhost:4000`
   - ✅ Should redirect to `/docs` (not show signup)

7. **Check `/docs` page:**
   - ✅ Should see credits balance (100 minutes)
   - ✅ Should see API key creation section

---

## Test 4: Multiple Environments (Database Separation)

### Verify data isolation:

**Development environment:**
```bash
# Current: Using middleware-dev.db
cd middleware-platform
npm start

# Sign up a test user in dev
# Go to http://localhost:4000 and create account
```

**Test environment:**
```bash
# Stop dev server
# Start test environment
NODE_ENV=test npm start

# Should use middleware-test.db (different file!)
# Sign up same email - should work (different DB)
```

**Production environment:**
```bash
# Stop test server  
# Start production
NODE_ENV=production npm start

# Should use middleware-prod.db (different file!)
# Data from dev/test should NOT be visible
```

---

## Quick Verification Checklist

- [ ] Root endpoint shows signup page when no session
- [ ] Root endpoint redirects to `/docs` when session exists
- [ ] Server logs show: `middleware-dev.db (environment: development)`
- [ ] Signup flow works end-to-end
- [ ] Session persists after accepting terms
- [ ] Database files are separate: `middleware-dev.db` vs `middleware-prod.db`

---

## Troubleshooting

**Issue: Still seeing signup page after login**
- Clear browser cookies
- Check browser DevTools → Application → Cookies
- Verify `customer_session` cookie exists

**Issue: Wrong database being used**
- Check server logs for database path
- Verify `NODE_ENV` is not set (should default to development)
- Check if `DB_NAME` environment variable is set

**Issue: Database not found**
- Database is created automatically on first use
- Check file permissions in home directory
- Verify `HOME` environment variable is set

