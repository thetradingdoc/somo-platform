# API Architecture Design

**Purpose:** Design the REST API layer for customer integrations.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CUSTOMER APPLICATION                     │
│              (Their own app/website/mobile)                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    DOCLITTLE API                            │
│              (REST API Layer - This Layer)                  │
│                                                              │
│  • Authentication (API Keys)                                │
│  • Rate Limiting                                            │
│  • Request Validation                                       │
│  • Response Formatting                                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              MIDDLEWARE PLATFORM                            │
│         (Existing Backend - No Changes Needed)              │
│                                                              │
│  • Voice Agent Functions                                    │
│  • FHIR Services                                            │
│  • Booking Services                                         │
│  • Insurance Services                                       │
│  • Payment Services                                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA LAYER                               │
│              (Database, External APIs)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 📡 API Design Principles

### 1. RESTful Design
- **HTTP Methods:** GET (read), POST (create), PUT (update), DELETE (remove)
- **Resource-Based URLs:** `/api/v1/appointments`, `/api/v1/patients`
- **Status Codes:** 200 (success), 201 (created), 400 (bad request), 401 (unauthorized), 404 (not found), 500 (error)

### 2. Versioning
- **URL Versioning:** `/api/v1/...`, `/api/v2/...`
- **Backward Compatible:** Old versions remain active
- **Version Lifecycle:** Support last 2 versions

### 3. Authentication
- **API Keys:** Per-customer API keys
- **Header Format:** `Authorization: Bearer <api_key>`
- **Key Rotation:** Support key rotation without downtime

### 4. Rate Limiting
- **Tiered Limits:** Based on customer plan
- **Headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Response:** 429 (Too Many Requests) with retry-after

### 5. Error Handling
- **Consistent Format:** All errors in same JSON structure
- **Error Codes:** Human-readable error codes
- **Messages:** Clear error messages
- **Documentation:** All error codes documented

---

## 🎯 API Endpoints Structure

### Core Resources

```
GET    /api/v1/appointments              # List appointments
POST   /api/v1/appointments              # Create appointment
GET    /api/v1/appointments/:id          # Get appointment
PUT    /api/v1/appointments/:id          # Update appointment
DELETE /api/v1/appointments/:id          # Cancel appointment

GET    /api/v1/patients                  # List patients
POST   /api/v1/patients                  # Create patient
GET    /api/v1/patients/:id              # Get patient
PUT    /api/v1/patients/:id              # Update patient

POST   /api/v1/insurance/verify          # Verify insurance
POST   /api/v1/insurance/claims          # Submit claim
GET    /api/v1/insurance/claims/:id      # Get claim status

POST   /api/v1/voice/initiate            # Initiate voice call
POST   /api/v1/voice/calls/:id/end       # End voice call
GET    /api/v1/voice/calls/:id           # Get call status

POST   /api/v1/payments/checkout         # Create checkout
POST   /api/v1/payments/verify           # Verify payment
GET    /api/v1/payments/:id              # Get payment status
```

### Configuration & Management

```
GET    /api/v1/config                    # Get customer config
PUT    /api/v1/config                    # Update config
GET    /api/v1/webhooks                  # List webhooks
POST   /api/v1/webhooks                  # Create webhook
DELETE /api/v1/webhooks/:id              # Delete webhook

GET    /api/v1/usage                     # Get usage stats
GET    /api/v1/billing                   # Get billing info
```

---

## 🔐 Authentication Design

### API Key Structure

```
Format: dl_live_<customer_id>_<random_32_chars>
Example: dl_live_cust_abc123_7f3a9b2c4d5e6f8a9b1c2d3e4f5a6b7c
```

**Components:**
- `dl_live_` - Prefix (indicates DocLittle API key)
- `cust_abc123` - Customer ID
- `32_chars` - Random secret

### Key Storage
- **Azure Key Vault:** Store API keys securely
- **Database:** Store key metadata (customer_id, created_at, expires_at, permissions)
- **Encryption:** Keys encrypted at rest

### Key Rotation
- **Support:** Multiple active keys per customer
- **Grace Period:** Old keys work for 7 days after rotation
- **Webhook:** Notify customer when key is rotated

---

## 📊 Rate Limiting Design

### Tiered Limits

```
Starter Plan:
  - 1,000 requests/hour
  - 10,000 requests/day

Professional Plan:
  - 10,000 requests/hour
  - 100,000 requests/day

Enterprise Plan:
  - 100,000 requests/hour
  - 1,000,000 requests/day
  - Custom limits available
```

### Implementation
- **Redis:** Store rate limit counters (per API key)
- **Algorithm:** Token bucket or sliding window
- **Headers:** Always include rate limit info in responses

---

## 🔔 Webhook System Design

### Webhook Events

```
appointment.created
appointment.confirmed
appointment.cancelled
appointment.rescheduled

patient.created
patient.updated

insurance.verified
insurance.claim.submitted
insurance.claim.approved
insurance.claim.rejected

payment.checkout.created
payment.completed
payment.failed

voice.call.started
voice.call.ended
voice.call.function_called
```

### Webhook Delivery
- **HTTP POST:** Send to customer's webhook URL
- **Retry Logic:** Exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Signatures:** HMAC-SHA256 signature for verification
- **Idempotency:** Include `idempotency_key` in webhook payload

---

## 📦 Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    // Resource data here
  },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2025-11-15T10:00:00Z"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid appointment date",
    "details": {
      "field": "date",
      "reason": "Date must be in the future"
    }
  },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2025-11-15T10:00:00Z"
  }
}
```

---

## 🛡️ Security Considerations

### Data Encryption
- **In Transit:** HTTPS only (TLS 1.2+)
- **At Rest:** Azure Key Vault for secrets, database encryption

### Input Validation
- **Schema Validation:** JSON Schema for all requests
- **Sanitization:** Sanitize all inputs
- **SQL Injection:** Parameterized queries only

### Access Control
- **IP Whitelisting:** Optional per customer
- **Scope Permissions:** API keys can have limited scopes
- **Audit Logging:** Log all API calls for security audit

---

## 📈 Scalability Considerations

### Horizontal Scaling
- **Stateless API:** API layer is stateless (can scale horizontally)
- **Load Balancer:** Azure Load Balancer for distribution
- **Auto-scaling:** Scale based on request volume

### Caching
- **Redis:** Cache frequent queries (patient lookup, config)
- **CDN:** Cache static assets (docs, SDKs)

### Database
- **Connection Pooling:** Use connection pooler
- **Read Replicas:** Separate read/write database
- **Query Optimization:** Index frequently queried fields

---

## 🔍 Monitoring & Logging

### Metrics to Track
- **Request Volume:** Requests per minute/hour/day
- **Error Rate:** Percentage of failed requests
- **Response Time:** P50, P95, P99 latency
- **Rate Limit Hits:** How often customers hit limits

### Logging
- **Structured Logging:** JSON logs for easy parsing
- **Request ID:** Include in all logs for tracing
- **Customer ID:** Include in logs (for support)

### Tools
- **Azure Monitor:** Application insights, metrics
- **Azure Log Analytics:** Query logs
- **Sentry:** Error tracking (if needed)

---

## 🚀 Deployment Strategy

### API Server
- **Azure App Service:** Host API layer
- **Multiple Regions:** Deploy to multiple Azure regions
- **Health Checks:** `/health` endpoint for monitoring

### Database
- **Azure Database for PostgreSQL:** Production database
- **Read Replicas:** For read-heavy workloads
- **Backups:** Automated daily backups

### CDN
- **Azure CDN:** Serve static assets (docs, SDKs)
- **Custom Domain:** `api.doclittle.site`

---

## 📚 Documentation Requirements

### API Documentation
- **OpenAPI/Swagger:** Auto-generated from code
- **Interactive Docs:** Try API calls in browser
- **Code Examples:** JavaScript, Python, cURL

### SDK Documentation
- **Installation:** npm/pip install instructions
- **Getting Started:** Quick start guide
- **API Reference:** Full method documentation
- **Examples:** Common use cases

### Integration Guide
- **Onboarding:** Step-by-step setup
- **Best Practices:** Security, error handling, webhooks
- **Troubleshooting:** Common issues and solutions

---

## 🎯 Implementation Phases

### Phase 1: Core API (Week 1-2)
- Authentication (API keys)
- Rate limiting
- Basic endpoints (appointments, patients)
- Error handling
- Documentation

### Phase 2: Advanced Features (Week 3-4)
- Webhook system
- Payment endpoints
- Voice call endpoints
- Customer dashboard
- SDK (JavaScript)

### Phase 3: Polish & Scale (Week 5-6)
- Python SDK
- Performance optimization
- Monitoring/alerting
- Documentation improvements
- Load testing

---

**Status:** 🚧 Design Phase  
**Next Step:** Review and approve design before implementation

