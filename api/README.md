# DocLittle API - Customer Integration Layer

**Purpose:** Enable customers to integrate DocLittle voice agent into their own applications.

**Pricing:** $1,000+ installation fee + monthly API usage

> **Documentation**: [docs/](../docs/README.md) is the source of truth. API docs live in [docs/api/](../docs/api/).

---

## 📋 Table of Contents

1. [API Reference](../docs/api/API_DOCUMENTATION.md) — Complete API documentation
2. [Invoice API](../docs/api/INVOICE_API.md) — Invoice endpoints
3. [SDK & Examples](./examples/README.md) (Coming Soon)

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
└── examples/                    # Code examples & SDKs (Coming Soon)
    ├── README.md               # Examples index
    ├── javascript/             # JavaScript SDK & examples
    ├── python/                 # Python SDK & examples
    └── curl/                   # cURL examples

Documentation in docs/api/:
├── docs/api/
│   ├── API_DOCUMENTATION.md    # Complete API reference
│   └── INVOICE_API.md          # Invoice endpoints
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
**Last Updated:** January 2026

