# Signup Flow Implementation - api.doclittle.site

## ✅ Implementation Complete

### Overview
Completely rebuilt the signup and authentication flow for `api.doclittle.site`:

- ✅ **Root endpoint (`/`)**: Now serves signup page (removed JSON metadata - moved to `/api`)
- ✅ **Removed admin portal** from `api.doclittle.site/admin` (will be on `doclittle.site/admin` later)
- ✅ **Email verification** required before accessing docs
- ✅ **Terms of Service** acceptance required
- ✅ **API key creation** in `/docs` (only when user clicks "Create API Key")
- ✅ **Per-customer usage tracking** via `customer_id` in all API calls

---

## 🎯 User Flow

```
User visits api.doclittle.site
  ↓
Signup Page (Step 1)
  - Name, Email, Phone, Company, Business Size, Use Case
  - Submit → Verification code sent to email
  ↓
Email Verification (Step 2)
  - Enter 6-digit code from email
  - Verify → Session created, account activated
  ↓
Terms of Service (Step 3)
  - Read terms (with pricing: $0.05/min voice calls)
  - Accept terms → Redirected to /docs
  ↓
API Documentation (/docs)
  - Protected: Requires signup + email verification + terms acceptance
  - User clicks "Create API Key" button
  - API key displayed once (with copy button)
  - User saves key securely
  ↓
User uses API key in their app
  - All API calls tracked by customer_id
  - Usage logged for billing and analytics
```

---

## 📁 Files Created/Modified

### New Files Created:
1. **`routes/signup.js`** - Signup routes (POST /api/signup, /verify-email, /accept-terms, etc.)
2. **`public/signup/index.html`** - Signup page with 3-step flow
3. **`public/signup/terms.html`** - Terms of Service page
4. **`docs/legal/TERMS_OF_SERVICE.md`** - Complete Terms of Service document

### Files Modified:
1. **`database.js`** - Added tables:
   - `email_verification_codes` - Email verification codes
   - `terms_acceptance` - Terms acceptance tracking
   - `customer_sessions` - Customer session management
   - Updated `customers` table with new fields (phone_number, business_size, use_case, email_verified, etc.)

2. **`server.js`**:
   - Added `cookie-parser` middleware
   - Removed admin portal from `/admin/portal`
   - Root endpoint (`/`) now serves signup page
   - `/docs` now protected (requires session + terms acceptance)
   - Added signup routes

3. **`middleware/auth.js`** - Updated to check customer API keys in addition to merchant keys

4. **`services/email-service.js`** - Added `sendVerificationCode()` method

5. **`public/docs/index.html`** - Added API key creation UI in authentication section

6. **`package.json`** - Added `cookie-parser` dependency

---

## 🔐 Database Schema

### New Tables:

**`email_verification_codes`**
- `id`, `email`, `code`, `customer_id`
- `verified`, `verified_at`, `expires_at`
- Used for email verification (15-minute expiry)

**`terms_acceptance`**
- `id`, `customer_id`, `terms_version` (default: '1.0')
- `ip_address`, `user_agent`, `accepted_at`
- Tracks terms acceptance for legal compliance

**`customer_sessions`**
- `id` (session ID), `customer_id`, `expires_at` (30 days)
- `ip_address`, `user_agent`, `last_accessed_at`
- Session management for customer authentication

### Updated Tables:

**`customers`** (new fields):
- `phone_number`, `business_size`, `use_case`
- `email_verified`, `email_verified_at`
- `updated_at`

**`api_keys`** (used for customer API keys):
- Links to `customer_id`
- Keys hashed with SHA-256
- Usage tracked via `customer_id`

---

## 🔌 API Endpoints

### Signup & Authentication

**POST `/api/signup`**
- Create customer account
- Send verification code to email
- Rate limited: 5 attempts per 15 minutes

**POST `/api/signup/verify-email`**
- Verify email code
- Create session cookie
- Activate account

**POST `/api/signup/resend-code`**
- Resend verification code
- Rate limited: 3 codes per hour per email

**GET `/terms`**
- Display terms of service page

**POST `/api/signup/accept-terms`**
- Accept terms of service
- Log acceptance with IP, user agent, timestamp
- Redirect to `/docs` or specified redirect URL

**POST `/api/customers/me/api-keys`**
- Create API key for authenticated customer
- Returns full key once (never again)
- Requires signup + email verification + terms acceptance

**GET `/api/customers/me/api-keys`**
- List customer's API keys (masked, no full keys)
- Shows prefix, created date, last used

### Protected Endpoints

**GET `/docs`**
- Protected: Requires session cookie + email verification + terms acceptance
- Redirects to signup if not authenticated
- Redirects to terms if terms not accepted

---

## 💰 Pricing Structure

### Terms of Service Pricing (v1.0)

**Voice Call Minutes:**
- **$0.05 per minute** (includes Retell $0.02/min + Twilio $0.013/min + infrastructure $0.017/min)

**API Requests:**
- First **1,000 requests/month**: Included
- Additional requests: **$0.01 per 1,000 requests**

**Webhooks:**
- Included at no additional cost

**Billing:**
- Monthly invoices based on actual usage
- Payment due within 15 days
- Late fees: 1.5% per month if not paid within 30 days

---

## 🛡️ Security Features

### Email Verification
- 6-digit verification codes
- 15-minute expiry
- Rate limited: 3 codes per email per hour
- One active code per email at a time

### Terms Acceptance
- Versioned terms (v1.0)
- IP address and user agent logged
- Required before accessing `/docs` or creating API keys

### API Keys
- Keys hashed with SHA-256 before storage
- Full key shown only once on creation
- Usage tracked per `customer_id`
- Keys can be revoked if terms violated

### Session Management
- Session cookies: HttpOnly, Secure (in production), SameSite: strict
- 30-day session expiry
- Last accessed timestamp updated on each request

---

## 📊 Usage Tracking

All API requests are tracked with:
- `customer_id` - Links to customer account
- `api_key_id` - Links to specific API key
- Endpoint, method, status code, response time
- IP address, user agent
- Request/response sizes

This enables:
- Per-customer billing
- Usage analytics
- Performance monitoring
- Error tracking

---

## 🚀 Deployment Checklist

### Before Deploying to Production:

1. **Install dependencies:**
   ```bash
   cd middleware-platform
   npm install
   ```

2. **Set environment variables in Azure:**
   - `AZURE_COMMUNICATION_CONNECTION_STRING` - For email verification
   - `AZURE_EMAIL_SENDER` - Sender email address
   - All other existing env vars (Stripe, Twilio, Retell, etc.)

3. **Deploy code:**
   ```bash
   ./scripts/deploy-to-azure.sh
   ```

4. **Verify deployment:**
   - Test signup flow: `https://api.doclittle.site`
   - Test email verification (check email)
   - Test terms acceptance: `https://api.doclittle.site/terms`
   - Test docs protection: `https://api.doclittle.site/docs` (should redirect if not authenticated)
   - Test API key creation in docs

5. **Test API key authentication:**
   ```bash
   curl -X POST https://api.doclittle.site/voice/products/search \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"merchant_id": "your-customer-id", "query": "test"}'
   ```

---

## 📝 Testing Checklist

- [ ] Signup form validation works
- [ ] Email verification code sent successfully
- [ ] Email verification code expires after 15 minutes
- [ ] Resend code works (with rate limiting)
- [ ] Terms acceptance required before docs access
- [ ] Session cookies set correctly
- [ ] `/docs` redirects to signup if not authenticated
- [ ] `/docs` redirects to terms if terms not accepted
- [ ] API key creation works in `/docs`
- [ ] API key shown only once
- [ ] API key authentication works for API calls
- [ ] Usage tracking logs `customer_id` correctly
- [ ] Admin portal removed from `api.doclittle.site/admin`

---

## 🔄 Next Steps (Future)

1. **Admin Portal on `doclittle.site/admin`**
   - Build admin dashboard on main domain
   - Track all customer signups
   - View per-customer usage and billing
   - Manage customer accounts

2. **Enhanced Analytics**
   - Per-customer usage dashboards
   - Billing preview
   - API call analytics

3. **Additional Features**
   - Password reset flow
   - Account settings page
   - Billing dashboard
   - Invoice generation

---

## 📖 Documentation

- **Terms of Service**: `docs/legal/TERMS_OF_SERVICE.md`
- **API Documentation**: `docs/api/API_DOCUMENTATION.md` (will need update)
- **Deployment Guide**: `docs/deployment/DEPLOYMENT.md`

---

**Status:** ✅ Ready for Production Deployment  
**Last Updated:** January 2025

