# DocLittle API - Customer Integration Layer

**Purpose:** Enable customers to integrate DocLittle voice agent into their own applications.

**Pricing:** $1,000+ installation fee + monthly API usage

---

## 📋 Table of Contents

1. [API Architecture](./design/API_ARCHITECTURE.md)
2. [Authentication](./design/AUTHENTICATION.md)
3. [API Reference](./docs/API_REFERENCE.md)
4. [Webhooks](./design/WEBHOOKS.md)
5. [SDK & Examples](./examples/README.md)

---

## 🎯 Goals

1. **Easy Integration** - Simple REST API, clear documentation
2. **Secure** - API key authentication, rate limiting, encryption
3. **Scalable** - Handles multiple customers, high volume
4. **Documented** - Complete API docs, SDK examples
5. **Flexible** - Customer-specific configurations, white-labeling

---

## 📁 Folder Structure

```
api/
├── README.md                    # This file
├── design/                      # Architecture & design documents
│   ├── API_ARCHITECTURE.md     # Overall API architecture
│   ├── AUTHENTICATION.md       # Auth strategy
│   ├── WEBHOOKS.md             # Webhook system design
│   ├── RATE_LIMITING.md        # Rate limiting strategy
│   └── CUSTOMER_CONFIG.md      # Customer configuration system
├── docs/                        # API documentation
│   ├── API_REFERENCE.md        # Complete API reference
│   ├── QUICK_START.md          # Quick start guide
│   └── INTEGRATION_GUIDE.md    # Full integration guide
└── examples/                    # Code examples & SDKs
    ├── README.md               # Examples index
    ├── javascript/             # JavaScript SDK & examples
    ├── python/                 # Python SDK & examples
    └── curl/                   # cURL examples
```

---

## 🔐 Security Model

- **API Keys:** Per-customer API keys for authentication
- **Rate Limiting:** Per-customer rate limits (tiered)
- **Encryption:** HTTPS only, data encryption at rest
- **IP Whitelisting:** Optional IP restriction per customer
- **Webhook Signatures:** HMAC signatures for webhook security

---

## 🚀 Quick Start (Coming Soon)

1. Get API key from DocLittle dashboard
2. Install SDK: `npm install @doclittle/api`
3. Initialize client with API key
4. Make first API call

---

**Status:** 🚧 Design Phase  
**Last Updated:** November 15, 2025

