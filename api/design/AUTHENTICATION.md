# API Authentication Design

**Purpose:** Secure authentication system for customer API access.

---

## 🔐 Authentication Strategy

### API Key Authentication

**Method:** Bearer token in Authorization header

```
Authorization: Bearer dl_live_cust_abc123_7f3a9b2c4d5e6f8a9b1c2d3e4f5a6b7c
```

### Key Format

```
dl_live_<customer_id>_<random_32_chars>

Components:
- Prefix: "dl_live_" (DocLittle Live API key)
- Customer ID: "cust_abc123" (customer identifier)
- Secret: 32 random hex characters

Example:
dl_live_cust_abc123_7f3a9b2c4d5e6f8a9b1c2d3e4f5a6b7c
```

---

## 🔑 Key Management

### Storage

**Azure Key Vault:**
- Store API key secrets securely
- Encrypted at rest
- Access controlled via Azure RBAC

**Database (middleware.db → PostgreSQL):**
```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  key_prefix TEXT NOT NULL,        -- "dl_live_cust_abc123_"
  key_hash TEXT NOT NULL,          -- SHA-256 hash of full key
  key_secret TEXT NOT NULL,        -- Encrypted secret (stored in Key Vault reference)
  scopes TEXT,                     -- JSON array: ["appointments:write", "patients:read"]
  rate_limit_tier TEXT,            -- "starter", "professional", "enterprise"
  ip_whitelist TEXT,               -- JSON array of allowed IPs (optional)
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,             -- NULL = never expires
  last_used_at DATETIME,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  company_name TEXT,
  plan_tier TEXT DEFAULT 'starter',  -- "starter", "professional", "enterprise"
  status TEXT DEFAULT 'active',      -- "active", "suspended", "cancelled"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Key Generation

**Process:**
1. Customer signs up via dashboard
2. System generates unique customer_id: `cust_<uuid>`
3. Generate random 32-char secret
4. Create key: `dl_live_<customer_id>_<secret>`
5. Hash key: SHA-256 hash for database lookup
6. Store encrypted secret in Azure Key Vault
7. Store hash + metadata in database

**Security:**
- Never store full API key in database
- Store only hash for lookup
- Store encrypted secret in Key Vault
- Key never transmitted after initial creation (display once only)

---

## 🔒 Authentication Flow

### Request Flow

```
1. Customer sends request with API key:
   GET /api/v1/appointments
   Authorization: Bearer dl_live_cust_abc123_7f3a9b2c...

2. API Server extracts key from header

3. Extract customer_id from key format:
   "dl_live_cust_abc123_7f3a9b2c..." → "cust_abc123"

4. Hash the key: SHA-256(key)

5. Look up in database:
   SELECT * FROM api_keys 
   WHERE key_hash = ? AND customer_id = ? AND is_active = 1

6. If found:
   - Check expiration (expires_at > NOW())
   - Check IP whitelist (if configured)
   - Load customer from customers table
   - Load scopes/permissions
   - Attach to request context

7. If not found or invalid:
   - Return 401 Unauthorized
```

### Response on Success
- Request continues to middleware
- Customer context available in all routes
- Rate limiting applied based on tier

### Response on Failure
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid API key"
  }
}
```

---

## 🛡️ Security Features

### 1. Key Rotation

**Process:**
- Customer can generate new key from dashboard
- Old key remains active for 7 days (grace period)
- Webhook sent: `api_key.rotated`
- Old key auto-deactivated after grace period

**Implementation:**
- Support multiple active keys per customer
- Track which key is "primary" vs "old"
- Allow customer to manually revoke keys

### 2. IP Whitelisting (Optional)

**Configuration:**
- Customer can whitelist IPs in dashboard
- Supports CIDR notation: `192.168.1.0/24`
- If whitelist is empty, allow all IPs

**Validation:**
- Check IP whitelist after key validation
- Return 403 if IP not whitelisted

### 3. Scope-Based Permissions

**Scopes:**
```
appointments:read    - Read appointments
appointments:write   - Create/update appointments
patients:read        - Read patients
patients:write       - Create/update patients
insurance:read       - Read insurance info
insurance:write      - Submit claims
payments:read        - Read payment info
payments:write       - Create payments
voice:read           - Read voice call info
voice:write          - Initiate voice calls
```

**Usage:**
- Store scopes as JSON array in `api_keys.scopes`
- Check scope before allowing action
- Return 403 if scope not granted

### 4. Rate Limiting Per Key

**Tiers:**
- Starter: 1,000/hour
- Professional: 10,000/hour
- Enterprise: 100,000/hour (custom)

**Implementation:**
- Redis counter: `rate_limit:<key_hash>:<hour>`
- Increment on each request
- Return 429 if limit exceeded

---

## 🔍 Audit Logging

### Log Every API Call

**Database Table:**
```sql
CREATE TABLE api_audit_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  method TEXT NOT NULL,              -- "GET", "POST", etc.
  endpoint TEXT NOT NULL,            -- "/api/v1/appointments"
  request_id TEXT NOT NULL,          -- Unique request ID
  ip_address TEXT,
  user_agent TEXT,
  status_code INTEGER,               -- 200, 400, 401, etc.
  response_time_ms INTEGER,          -- How long request took
  error_code TEXT,                   -- Error code if failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);
```

**Purposes:**
- Security audit trail
- Usage analytics
- Debugging
- Compliance

---

## 🚨 Security Best Practices

### For Customers

1. **Store Keys Securely:**
   - Never commit keys to git
   - Use environment variables
   - Rotate keys regularly

2. **Use HTTPS Only:**
   - All API calls over HTTPS
   - Never send keys over HTTP

3. **Implement IP Whitelisting:**
   - Restrict to known IPs if possible
   - Reduces risk of key theft

4. **Monitor Usage:**
   - Check dashboard for unusual activity
   - Set up webhook alerts for failures

### For Us (DocLittle)

1. **Encrypt Keys:**
   - Azure Key Vault for secrets
   - Never log full keys

2. **Rate Limiting:**
   - Prevent abuse/brute force
   - Alert on suspicious activity

3. **Audit Logging:**
   - Log all API calls
   - Monitor for anomalies

4. **Key Expiration:**
   - Require key rotation after 90 days (optional)
   - Send expiration warnings

---

## 📋 Implementation Checklist

- [ ] Create `customers` table in database
- [ ] Create `api_keys` table in database
- [ ] Create `api_audit_log` table in database
- [ ] Set up Azure Key Vault
- [ ] Implement key generation endpoint
- [ ] Implement key validation middleware
- [ ] Implement scope checking
- [ ] Implement IP whitelist checking
- [ ] Implement audit logging
- [ ] Create customer dashboard for key management
- [ ] Add key rotation endpoint
- [ ] Add key revocation endpoint
- [ ] Add usage monitoring endpoint

---

**Status:** 🚧 Design Phase  
**Next Step:** Review and approve before implementation

