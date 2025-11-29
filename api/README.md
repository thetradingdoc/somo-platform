# DocLittle API - Customer Integration Layer

**Purpose:** Enable customers to integrate DocLittle voice agent into their own applications.

**Pricing:** $1,000+ installation fee + monthly API usage

---

## 📋 Table of Contents

1. [API Architecture](../docs/api/design/API_ARCHITECTURE.md)
2. [Authentication](../docs/api/design/AUTHENTICATION.md)
3. [Azure Integration](../docs/api/design/AZURE_INTEGRATION.md)
4. [Customer Configuration](../docs/api/design/CUSTOMER_CONFIG.md)
5. [API Reference](../docs/api/API_DOCUMENTATION.md)
6. [SDK & Examples](./examples/README.md) (Coming Soon)

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

Documentation has been moved to docs/api/:
├── docs/api/
│   ├── API_DOCUMENTATION.md    # Complete API reference
│   └── design/                 # Architecture & design documents
│       ├── API_ARCHITECTURE.md
│       ├── AUTHENTICATION.md
│       ├── AZURE_INTEGRATION.md
│       └── CUSTOMER_CONFIG.md
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

