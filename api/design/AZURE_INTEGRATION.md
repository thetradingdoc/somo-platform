# Azure Integration Strategy

**Purpose:** Leverage Azure services for secure, scalable API infrastructure.

---

## 🎯 Azure Services We'll Use

### ✅ Already Using
- **Azure Communication Services Email** - Email sending
- **Azure Connection String** - Configured for email

### 🆕 Will Use for API

1. **Azure Key Vault** - Store API keys securely
2. **Azure App Service** - Host API server
3. **Azure Database for PostgreSQL** - Production database
4. **Azure Cache for Redis** - Rate limiting, caching
5. **Azure Monitor** - Monitoring, logging
6. **Azure Functions** - Background jobs, webhooks
7. **Azure Storage** - Static assets, SDKs
8. **Azure CDN** - Fast delivery of docs/SDKs

---

## 🔐 Azure Key Vault

### Purpose
Store API keys, secrets, certificates securely.

### What We'll Store

**API Keys:**
```
Secret Name: api-key-<customer_id>-<key_id>
Secret Value: <encrypted_api_key_secret>
```

**Database Credentials:**
```
Secret Name: postgres-connection-string
Secret Value: postgresql://user:pass@host:5432/db
```

**External API Keys:**
```
Secret Name: retell-api-key
Secret Name: stripe-secret-key
Secret Name: circle-api-key
```

### Access Pattern

**In Code:**
```javascript
// Pseudo-code
const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential();
const client = new SecretClient(vaultUrl, credential);

// Get secret
const secret = await client.getSecret('api-key-cust-123');
const apiKeySecret = secret.value;
```

**Benefits:**
- ✅ Secrets never in code or config files
- ✅ Automatic rotation support
- ✅ Access control via Azure RBAC
- ✅ Audit logging of secret access

---

## 🚀 Azure App Service

### Purpose
Host the API server (Express.js/Node.js).

### Configuration

**App Service Plan:**
- Tier: Standard S1 or Premium P1
- OS: Linux
- Region: East US (or multi-region)

**Application Settings:**
```
AZURE_KEY_VAULT_URL=https://doclittle-vault.vault.azure.net/
DATABASE_URL=<from Key Vault>
REDIS_URL=<from Key Vault>
RETELL_API_KEY=<from Key Vault>
```

**Deployment:**
- Source: GitHub Actions or Azure DevOps
- Build: npm install, npm build
- Run: npm start

**Scaling:**
- Manual: 1-10 instances
- Auto-scale: Based on CPU/Memory/Requests
- Load balancer: Built-in to App Service

---

## 🗄️ Azure Database for PostgreSQL

### Purpose
Replace SQLite with production-ready database.

### Configuration

**Database Tier:**
- Server: Basic or General Purpose
- vCores: 2-4 vCores
- Storage: 100GB (auto-grow)
- Backup: 7-day retention

**Connection:**
- Connection string stored in Key Vault
- SSL required
- Connection pooling via PgBouncer

**Migration:**
- Export SQLite data
- Import to PostgreSQL
- Update connection string
- Test thoroughly

**Benefits:**
- ✅ Concurrent connections (vs SQLite's 1)
- ✅ Better performance at scale
- ✅ Automated backups
- ✅ Read replicas for scaling
- ✅ Point-in-time restore

---

## 📦 Azure Cache for Redis

### Purpose
Rate limiting counters and caching.

### What We'll Cache

**Rate Limiting:**
```
Key: rate_limit:<api_key_hash>:<hour>
Value: request_count (integer)
TTL: 3600 seconds (1 hour)
```

**Patient Lookup:**
```
Key: patient:<phone_number>
Value: patient JSON
TTL: 3600 seconds (1 hour)
```

**Configuration:**
```
Key: config:<customer_id>
Value: config JSON
TTL: 300 seconds (5 minutes)
```

### Configuration

**Cache Tier:**
- Basic C0 (256MB) for development
- Standard C1 (1GB) for production
- Premium for high availability

**Connection:**
- Redis URL stored in Key Vault
- SSL enabled
- Access key in Key Vault

---

## 📊 Azure Monitor

### Purpose
Monitor API performance, errors, usage.

### What We'll Monitor

**Metrics:**
- Request rate (requests/minute)
- Response time (p50, p95, p99)
- Error rate (% of 4xx/5xx)
- Rate limit hits
- Database query time

**Logs:**
- All API requests (structured JSON)
- Errors with stack traces
- Authentication failures
- Slow queries

**Alerts:**
- Error rate > 1%
- Response time p95 > 1 second
- Database connection failures
- Key Vault access failures

### Tools
- **Application Insights:** APM, distributed tracing
- **Log Analytics:** Query logs, create dashboards
- **Azure Metrics:** Real-time metrics
- **Alert Rules:** Notify on issues

---

## ⚡ Azure Functions

### Purpose
Background jobs, async webhook delivery.

### Functions We'll Create

**1. Webhook Delivery**
- Trigger: New webhook event
- Action: HTTP POST to customer's webhook URL
- Retry: Exponential backoff
- Dead-letter queue: Failed after 5 retries

**2. Appointment Reminders**
- Trigger: Scheduled (daily at 8am)
- Action: Send reminder emails for appointments tomorrow
- Retry: 3 attempts

**3. Usage Aggregation**
- Trigger: Scheduled (hourly)
- Action: Aggregate API usage stats
- Store: In database for dashboard

**4. Key Rotation Reminder**
- Trigger: Scheduled (daily)
- Action: Check for keys expiring in 7 days
- Action: Send email to customer

### Configuration

**Function App:**
- Consumption plan (pay per execution)
- Node.js runtime
- Storage account for triggers

**Benefits:**
- ✅ Serverless (no server management)
- ✅ Auto-scale
- ✅ Pay only for what you use
- ✅ Background processing doesn't block API

---

## 📁 Azure Storage

### Purpose
Store static assets, SDK files, documentation.

### What We'll Store

**SDKs:**
```
blob.core.windows.net/sdks/
  - doclittle-js-sdk-1.0.0.tgz
  - doclittle-py-sdk-1.0.0.whl
```

**Documentation:**
```
blob.core.windows.net/docs/
  - api-reference.html
  - quick-start.html
```

**Customer Assets:**
```
blob.core.windows.net/customers/<customer_id>/
  - logos/
  - custom_prompts/
```

### CDN Integration

**Azure CDN:**
- Custom domain: `cdn.doclittle.site`
- HTTPS enabled
- Cache static assets
- Fast global delivery

---

## 🔄 Migration Plan

### Phase 1: Key Vault (Week 1)
- [ ] Set up Azure Key Vault
- [ ] Move secrets from `.env` to Key Vault
- [ ] Update code to read from Key Vault
- [ ] Test locally with Azure credentials

### Phase 2: Database (Week 2)
- [ ] Create Azure PostgreSQL database
- [ ] Export SQLite data
- [ ] Import to PostgreSQL
- [ ] Update connection string
- [ ] Test thoroughly

### Phase 3: Redis (Week 2)
- [ ] Create Azure Redis cache
- [ ] Implement rate limiting with Redis
- [ ] Add caching layer
- [ ] Test rate limits

### Phase 4: App Service (Week 3)
- [ ] Create App Service
- [ ] Deploy API code
- [ ] Configure app settings
- [ ] Set up CI/CD
- [ ] Test deployment

### Phase 5: Monitoring (Week 3)
- [ ] Set up Application Insights
- [ ] Configure alerts
- [ ] Create dashboards
- [ ] Test monitoring

### Phase 6: Functions (Week 4)
- [ ] Create Function App
- [ ] Implement webhook delivery function
- [ ] Implement reminder function
- [ ] Test functions

---

## 💰 Cost Estimation

### Monthly Costs (Estimated)

**Azure Key Vault:**
- Standard tier: ~$0.03 per 10,000 operations
- Estimated: $10-50/month

**Azure App Service:**
- Standard S1: ~$70/month
- Auto-scale: Additional costs

**Azure Database for PostgreSQL:**
- Basic tier (2 vCores): ~$120/month
- General Purpose: ~$400/month

**Azure Cache for Redis:**
- Basic C1 (1GB): ~$16/month
- Standard C1 (1GB): ~$55/month

**Azure Functions:**
- Consumption plan: ~$0.20 per million executions
- Estimated: $10-50/month

**Azure Monitor:**
- Free tier: 5GB logs/month
- Additional: $2.30/GB
- Estimated: $20-100/month

**Total Estimated:** $250-700/month (depending on usage)

---

## ✅ Benefits of Azure

1. **Security:**
   - Key Vault for secrets
   - Managed identity authentication
   - Built-in encryption

2. **Scalability:**
   - Auto-scaling App Service
   - Read replicas for database
   - CDN for global distribution

3. **Reliability:**
   - SLA guarantees (99.95% uptime)
   - Automated backups
   - Multi-region deployment

4. **Monitoring:**
   - Built-in Application Insights
   - Real-time metrics
   - Alert system

5. **Cost:**
   - Pay-as-you-go
   - No upfront costs
   - Scale up/down as needed

---

**Status:** 🚧 Design Phase  
**Next Step:** Review and approve before implementation

