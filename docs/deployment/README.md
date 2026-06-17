# deployment — consolidated documentation

> **Production (front-desk):** Start with **[`FRONT_DESK_PRODUCTION.md`](./FRONT_DESK_PRODUCTION.md)** — Firebase UI + Cloud Run API deploy, DNS order, smoke.
>
> **Historical:** Sections below may reference Azure App Service or other retired infra paths. **Do not follow them for current production.**

**Single file:** All former `docs/deployment/**/*.md` content is merged here. **Last updated:** 2026-06-14

<a id="voice-current-architecture"></a>

## Voice architecture (current production)

Production voice for **callsomo.com** runs on **Google Cloud Run** at `https://api.callsomo.com` (not the marketing SPA host).

| Path | Status |
|------|--------|
| Inbound: Twilio → `POST /voice/incoming` → Retell SIP → `wss://…/webhook/retell/llm` | Operational |
| Outbound (Twilio-direct → `/voice/incoming`) | Operational (default in app scripts/API) |
| Outbound (Retell `create-phone-call` / custom telephony) | Supported; requires aligned Twilio SIP trunk auth in Retell |

**Authoritative detail (do not duplicate here):** [`VOICE_CURRENT_ARCHITECTURE.md`](./VOICE_CURRENT_ARCHITECTURE.md)  
**Deploy / rollback / 429 troubleshooting:** [`docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)  
**Retell agent verify:** [`retell-agent-inventory.md`](./retell-agent-inventory.md) + [`retell-agent-inventory.json`](./retell-agent-inventory.json)

### Medical codebook (standalone runbooks)

These files are **not** merged into this README; use them for CPT/ICD imports, prod parity, and Render env:

- [MEDICAL_CODEBOOK_SETUP.md](./MEDICAL_CODEBOOK_SETUP.md) — CMS sources, MPFS import, embeddings, Pinecone, Stedi 837P
- [PROD_DB_PARITY.md](./PROD_DB_PARITY.md) — production row counts and migration checklist
- [RENDER_PRODUCTION_CHECKLIST.md](./RENDER_PRODUCTION_CHECKLIST.md) — Render env vars and webhook registration

Canonical architecture: [docs/Medical Coding/ARCHITECTURE.md](../Medical%20Coding/ARCHITECTURE.md).

## Table of contents

- [Voice architecture (current production)](#voice-current-architecture)
- [Medical codebook runbooks (standalone)](#medical-codebook-standalone-runbooks)
- [Automated Tenant Domain Setup (`azure/AUTOMATED_TENANT_DOMAIN_SETUP.md`)](#azure-automated-tenant-domain-setup)
- [Azure Environment Variables for Automated Domain Setup (`azure/AZURE_ENV_VARIABLES.md`)](#azure-azure-env-variables)
- [Case report service — Azure Container Instance (Phase 6 Task 50) (`CASE_REPORT_SERVICE_ACI.md`)](#case-report-service-aci)
- [CI and deployment — source of truth (`CI_AND_DEPLOY_SOURCE_OF_TRUTH.md`)](#ci-and-deploy-source-of-truth)
- [Postgres Migration & Infrastructure Hardening (`database/POSTGRES_MIGRATION.md`)](#database-postgres-migration)
- [Postgres Testing Guide (`database/POSTGRES_TESTING.md`)](#database-postgres-testing)
- [DNS Records to Add for Tenant Subdomains (`dns/DNS_RECORDS_TO_ADD.md`)](#dns-dns-records-to-add)
- [IONOS DNS Setup — api.callsomo.com (`dns/ionos/IONOS_DNS_SETUP.md`)](#dns-ionos-ionos-dns-setup)
- [api.callsomo.com SSL & Domain Setup (`dns/ssl/DOCLITTLE_SITE_SSL_SETUP.md`)](#dns-ssl-doclittle-site-ssl-setup)
- [Tenant Subdomain & DNS Setup (`dns/TENANT_AND_DNS_SETUP.md`)](#dns-tenant-and-dns-setup)
- [CI/CD Setup for Infrastructure Deployment (`guides/advanced/CI_CD_SETUP.md`)](#guides-advanced-ci-cd-setup)
- [Deployment Checklist - Language Detection Fix (`guides/advanced/DEPLOYMENT_CHECKLIST.md`)](#guides-advanced-deployment-checklist)
- [Signup Flow Implementation - api.api.callsomo.com (`guides/advanced/SIGNUP_FLOW_IMPLEMENTATION.md`)](#guides-advanced-signup-flow-implementation)
- [Database Backup Strategy (`guides/BACKUP_STRATEGY.md`)](#guides-backup-strategy)
- [Quick Deployment Guide - Azure App Service (`guides/basic/QUICK_DEPLOYMENT_GUIDE.md`)](#guides-basic-quick-deployment-guide)
- [Deployment Guide (`guides/DEPLOYMENT_GUIDE.md`)](#guides-deployment-guide)
- [Deployment Documentation (`README.md`)](#readme)
- [Somo.Site Setup Guide - SaaS Frontend on Azure (`security/DOCLITTLE_SITE_SETUP.md`)](#security-doclittle-site-setup)
- [Production Deployment - Per-Client API Keys & Admin Portal (`security/PRODUCTION_DEPLOYMENT_API_KEYS.md`)](#security-production-deployment-api-keys)
- [Security & Production Improvements (`security/SECURITY_IMPROVEMENTS.md`)](#security-security-improvements)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="azure-automated-tenant-domain-setup"></a>

## Automated Tenant Domain Setup

*Former path: `docs/deployment/azure/AUTOMATED_TENANT_DOMAIN_SETUP.md`*

**Last Updated**: December 2024  
**Status**: ✅ Implemented

---

## 🎯 Overview

When a new tenant signs up, the system automatically:
1. ✅ Sends welcome email with subdomain
2. ✅ **Adds custom domain to Azure App Service**
3. ✅ **Creates SSL certificate**
4. ✅ **Binds SSL certificate to domain**

This eliminates manual setup for each new tenant!

---

## 🔧 How It Works

### Provider SIM trial signup (canonical)

For SaaS self-serve trial (email → phone OTP → dedicated Twilio number → 60 min / 7 days), see:

- [PROVIDER_SIGNUP_FLOW.md](./PROVIDER_SIGNUP_FLOW.md)
- [PROVIDER_TRIAL_SIM_ARCHITECTURE.md](./PROVIDER_TRIAL_SIM_ARCHITECTURE.md)
- [STAGING_TRIAL_ROLLOUT.md](./STAGING_TRIAL_ROLLOUT.md) (staging env + smoke checklist)

Legacy card-first signup remains when `TRIAL_SIM_FLOW_ENABLED` is off.

### Signup Flow Integration

When a tenant completes signup in `server.js`:

```javascript
// After welcome email is sent:
AzureDomainService.setupTenantDomain(subdomain, {
  rootDomain: 'api.callsomo.com',
  appName: 'doclittle',
  resourceGroup: 'doclittle'
});
```

### Automated Steps

1. **Add Custom Domain** → Azure App Service
2. **Wait for DNS Verification** → 30 seconds
3. **Create SSL Certificate** → Azure managed certificate
4. **Wait for Certificate Issuance** → Up to 3 retries (1 min each)
5. **Bind SSL Certificate** → Enable HTTPS

---

## ⚙️ Configuration

### Environment Variables

Add these to your Azure App Settings (or `.env` for local):

```bash
# Azure Configuration (optional - defaults provided)
AZURE_ROOT_DOMAIN=api.callsomo.com
AZURE_APP_NAME=doclittle
AZURE_RESOURCE_GROUP=doclittle

# SSL Configuration (optional)
AZURE_SKIP_SSL=false              # Set to 'true' to skip SSL in dev
AZURE_SSL_MAX_RETRIES=3           # Max retries for certificate creation
AZURE_SSL_RETRY_DELAY_MS=60000    # Delay between retries (1 minute)
```

### Azure CLI Requirements

The automation requires:
- ✅ Azure CLI installed (`az` command)
- ✅ Logged into Azure (`az login`)
- ✅ Proper permissions to manage App Service

**Check setup:**
```bash
az account show  # Should show your subscription
```

---

## 📋 Prerequisites

### 1. Azure CLI Installation

**macOS:**
```bash
brew install azure-cli
```

**Linux:**
```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

**Windows:**
```powershell
# Via PowerShell
Invoke-WebRequest -Uri https://aka.ms/installazurecliwindows -OutFile .\AzureCLI.msi
```

### 2. Azure Login

```bash
az login
```

For CI/CD (non-interactive):
```bash
az login --service-principal \
  --username <app-id> \
  --password <password> \
  --tenant <tenant-id>
```

### 3. Required Permissions

The Azure account needs:
- ✅ `Website Contributor` role on App Service
- ✅ `Contributor` role on Resource Group (for SSL certificates)

---

## 🚀 Usage

### Automatic (Default)

**No action needed!** The system automatically sets up domains when tenants sign up.

### Manual Trigger (if needed)

```javascript
const AzureDomainService = require('./services/azure-domain-service');

const result = await AzureDomainService.setupTenantDomain('doctor-little', {
  rootDomain: 'api.callsomo.com',
  appName: 'doclittle',
  resourceGroup: 'doclittle'
});

console.log(result);
// {
//   success: true,
//   subdomain: 'doctor-little',
//   domain: 'doctor-little.api.callsomo.com',
//   steps: {
//     customDomain: { success: true, ... },
//     sslCertificate: { success: true, thumbprint: '...' },
//     sslBinding: { success: true, ... }
//   }
// }
```

---

## 🔍 Monitoring & Logs

### Success Logs

```
✅ Welcome email sent to user@example.com with subdomain: doctor-little
🌐 Starting automated Azure domain setup for subdomain: doctor-little
✅ Custom domain doctor-little.api.callsomo.com added to Azure App Service
📝 Creating SSL certificate for doctor-little.api.callsomo.com...
✅ SSL certificate created for doctor-little.api.callsomo.com (thumbprint: ABC123...)
✅ SSL certificate bound to doctor-little.api.callsomo.com
✅ Azure domain setup completed for doctor-little.doctor-little.api.callsomo.com
```

### Error Handling

The automation is **non-blocking**:
- ✅ Signup completes even if Azure setup fails
- ⚠️ Errors are logged but don't prevent tenant creation
- 🔧 Manual setup can be done later if needed

**Common Issues:**

1. **Azure CLI not installed**
   ```
   ⚠️  Skipping Azure domain setup: Azure CLI not installed
   ```

2. **Not logged in**
   ```
   ⚠️  Skipping Azure domain setup: Not logged into Azure
   ```

3. **DNS not propagated**
   ```
   ⚠️  SSL certificate creation failed: DNS verification failed
   ```
   **Solution:** Wait 5-30 minutes for DNS propagation, then retry manually

4. **Certificate taking too long**
   ```
   ⚠️  SSL certificate created but thumbprint not available after 3 retries
   ```
   **Solution:** Certificate is created but may take longer. Check Azure Portal.

---

## 🛠️ Troubleshooting

### Check Azure Setup

```bash
# Check if Azure CLI is installed
which az

# Check if logged in
az account show

# Check App Service
az webapp show --name doclittle --resource-group doclittle
```

### Verify Domain Setup

```bash
# List custom domains
az webapp config hostname list \
  --webapp-name doclittle \
  --resource-group doclittle

# Check SSL certificates
az webapp config ssl list \
  --resource-group doclittle
```

### Manual Retry

If automation fails, use the manual script:

```bash
./scripts/fix-doctor-little-ssl.sh
```

Or use the Azure service directly:

```javascript
const AzureDomainService = require('./services/azure-domain-service');
await AzureDomainService.setupTenantDomain('doctor-little');
```

---

## 🔐 Security Notes

1. **Azure Credentials**: Never commit Azure credentials to code
2. **Service Principal**: Use service principal for CI/CD (not personal account)
3. **Permissions**: Use least-privilege access (only App Service permissions needed)
4. **SSL Certificates**: Azure managed certificates are free and auto-renewed

---

## 📊 Status Tracking

The automation tracks each step:

```javascript
{
  success: true,
  subdomain: 'doctor-little',
  domain: 'doctor-little.api.callsomo.com',
  steps: {
    customDomain: {
      success: true,
      alreadyExists: false,
      domain: 'doctor-little.api.callsomo.com'
    },
    sslCertificate: {
      success: true,
      alreadyExists: false,
      domain: 'doctor-little.api.callsomo.com',
      thumbprint: 'ABC123...'
    },
    sslBinding: {
      success: true,
      alreadyBound: false,
      domain: 'doctor-little.api.callsomo.com',
      thumbprint: 'ABC123...'
    }
  }
}
```

---

## 🎯 Future Enhancements

- [ ] Database table to track domain setup status
- [ ] Admin dashboard to view/manage domain setup
- [ ] Retry queue for failed setups
- [ ] Email notification when setup completes
- [ ] Support for Cloudflare wildcard SSL (alternative)

---

## 📚 Related Documentation

- [Tenant & DNS Setup Guide](../README.md#dns-tenant-and-dns-setup) - Manual setup instructions
- [Wildcard DNS Explanation](./WILDCARD_DNS_EXPLANATION.md) - DNS vs Azure custom domains
- [Tenant & DNS Setup](../README.md#dns-tenant-and-dns-setup) - SSL and subdomain troubleshooting

---

**Last Updated**: December 2024  
**Maintained By**: Development Team




---

<a id="azure-azure-env-variables"></a>

## Azure Environment Variables for Automated Domain Setup

*Former path: `docs/deployment/azure/AZURE_ENV_VARIABLES.md`*

**Last Updated**: December 2024

---

## 📋 Required Variables

Add these to your `.env` file (or Azure App Settings in production):

```bash
# ============================================
# Azure App Service Configuration
# ============================================

# Root domain (e.g., api.callsomo.com)
AZURE_ROOT_DOMAIN=api.callsomo.com

# Azure App Service name
AZURE_APP_NAME=doclittle

# Azure Resource Group name
AZURE_RESOURCE_GROUP=doclittle

# ============================================
# SSL Certificate Configuration (Optional)
# ============================================

# Set to 'true' to skip SSL setup in development
# Default: false (SSL will be set up automatically)
AZURE_SKIP_SSL=false

# Maximum retries for SSL certificate creation
# Default: 3
AZURE_SSL_MAX_RETRIES=3

# Delay between SSL retries (milliseconds)
# Default: 60000 (1 minute)
AZURE_SSL_RETRY_DELAY_MS=60000
```

---

## 🔧 Default Values

If you don't set these variables, the system uses these defaults:

- `AZURE_ROOT_DOMAIN` → `api.callsomo.com`
- `AZURE_APP_NAME` → `doclittle`
- `AZURE_RESOURCE_GROUP` → `doclittle`
- `AZURE_SKIP_SSL` → `false`
- `AZURE_SSL_MAX_RETRIES` → `3`
- `AZURE_SSL_RETRY_DELAY_MS` → `60000` (1 minute)

**So if your Azure setup matches these defaults, you don't need to add anything!**

---

## 📝 Example `.env` File

Here's what your `.env` might look like with Azure variables:

```bash
# Existing variables...
NODE_ENV=production
PORT=4000
DATABASE_URL=...

# Azure Configuration
AZURE_ROOT_DOMAIN=api.callsomo.com
AZURE_APP_NAME=doclittle
AZURE_RESOURCE_GROUP=doclittle

# Optional: Skip SSL in development
# AZURE_SKIP_SSL=true

# Optional: Adjust retry behavior
# AZURE_SSL_MAX_RETRIES=5
# AZURE_SSL_RETRY_DELAY_MS=120000
```

---

## 🚀 Azure App Settings (Production)

In Azure Portal, add these as **App Settings**:

1. Go to **Azure Portal** → Your App Service (`doclittle`)
2. Navigate to **Configuration** → **Application settings**
3. Click **+ New application setting**
4. Add each variable:

| Name | Value | Example |
|------|-------|---------|
| `AZURE_ROOT_DOMAIN` | Your root domain | `api.callsomo.com` |
| `AZURE_APP_NAME` | App Service name | `doclittle` |
| `AZURE_RESOURCE_GROUP` | Resource group | `doclittle` |
| `AZURE_SKIP_SSL` | `false` or `true` | `false` |
| `AZURE_SSL_MAX_RETRIES` | Number (optional) | `3` |
| `AZURE_SSL_RETRY_DELAY_MS` | Milliseconds (optional) | `60000` |

5. Click **Save**
6. Restart the App Service

---

## ✅ Verification

After adding variables, verify they're loaded:

```javascript
// In your code or Node REPL
console.log('AZURE_ROOT_DOMAIN:', process.env.AZURE_ROOT_DOMAIN);
console.log('AZURE_APP_NAME:', process.env.AZURE_APP_NAME);
console.log('AZURE_RESOURCE_GROUP:', process.env.AZURE_RESOURCE_GROUP);
```

Or check in Azure Portal:
- **Configuration** → **Application settings** → Search for `AZURE_`

---

## 🔍 Troubleshooting

### Variables Not Loading

1. **Check `.env` file location**
   - Should be in `middleware-platform/` directory
   - Or root directory (if using `dotenv` from root)

2. **Check Azure App Settings**
   - Variables must be set in **Application settings** (not Connection strings)
   - Restart App Service after adding variables

3. **Check Environment**
   - Local: Uses `.env` file
   - Production: Uses Azure App Settings

### Using Defaults

If variables aren't set, the system will:
- ✅ Use default values (see above)
- ✅ Still work for most setups
- ⚠️ Log warnings if Azure CLI is not available

---

## 📚 Related Documentation

- [Automated Tenant Domain Setup](./AUTOMATED_TENANT_DOMAIN_SETUP.md) - How the automation works
- [Tenant & DNS Setup Guide](../README.md#dns-tenant-and-dns-setup) - Manual setup instructions

---

**Last Updated**: December 2024




---

<a id="case-report-service-aci"></a>

## Case report service — Azure Container Instance (Phase 6 Task 50)

*Former path: `docs/deployment/CASE_REPORT_SERVICE_ACI.md`*


Deploy the case report service as an Azure Container Instance: 1 vCPU, 2 GB RAM, always-on, restart policy Always.

## Requirements

- Azure CLI logged in (`az login`)
- Resource group and container registry (or use public image from ACR/other)

## Env vars (set in ACI)

| Variable | Description |
|----------|-------------|
| `AZURE_STORAGE_CONNECTION_STRING` | For blob reads under `patient-uploads` |
| `OPENAI_API_KEY` | For pipeline (if layer logic uses OpenAI) |
| `PINECONE_API_KEY` | For RAG (if layer logic uses Pinecone) |
| `SERVICE_TOKEN` | Optional service auth |
| `STORAGE_BACKEND` | `azure_blob` or `local` |

## Example: deploy with Azure CLI

```bash
# Build and push image (example ACR)
az acr build --registry <your-acr> --image case-report-service:latest -f case-report-service/Dockerfile .

# Create ACI (1 vCPU, 2 GB RAM, always restart)
az container create \
  --resource-group <rg> \
  --name case-report-service \
  --image <your-acr>.azurecr.io/case-report-service:latest \
  --cpu 1 \
  --memory 2 \
  --ports 8080 \
  --restart-policy Always \
  --environment-variables \
    STORAGE_BACKEND=azure_blob \
    SERVICE_VERSION=0.1.0 \
  --secure-environment-variables \
    AZURE_STORAGE_CONNECTION_STRING="<connection-string>" \
    OPENAI_API_KEY="<key>" \
    PINECONE_API_KEY="<key>"

# Expose via LB or use private ACI + VNet integration
az container show --resource-group <rg> --name case-report-service --query "ipAddress.fqdn" -o tsv
```

## Health check

- **GET /health** → `{ "status": "ok", "version": "...", "storage_backend": "azure_blob" }`
- **POST /report** → `202 { "job_id": "...", "status": "queued" }`

## Middleware integration

Middleware triggers the service with:

- `POST {CASE_REPORT_SERVICE_URL}/report` with body: `job_id`, `patient_id`, `encounter_id`, `appointment_id`, `transcript_endpoint`, `transcript_endpoint_token`, `prior_report_id`, `callback_url`, `callback_token`.
- Service processes in background and POSTs result to `callback_url` with `X-Callback-Token: <callback_token>`.


---

<a id="ci-and-deploy-source-of-truth"></a>

## CI and deployment — source of truth

*Former path: `docs/deployment/CI_AND_DEPLOY_SOURCE_OF_TRUTH.md`*


## Continuous integration

Workflow file: **`.github/workflows/ci.yml`**

- **Triggers:** push/PR to `main`, `master`, `develop`; manual `workflow_dispatch`.
- **Test job:** runs on **Node 18.x and 20.x** (matrix). Steps include middleware `npm ci`, `node --check` on all `.js` files, Jest, repo-root scripts (perf budgets, auth UI guardrails, retention dry-run), **agentic checkout static verify**, **patient-app `tsc`**, optional Cypress (only if `middleware-platform/cypress/` exists), clinical prep gate when configured.
- **Security job:** `npm audit` (non-blocking today) and a heuristic grep for secrets (non-blocking).
- **Build job:** Starts `server.js` briefly under timeout.

**Local parity:** run the commands in **root `CONTRIBUTING.md`** before opening a PR.

## Deployment

The workflow **Deploy to Railway** job is a **placeholder**: it prints that checks passed and notes Railway may auto-deploy on push. **Actual deployment** is whatever your team configured in **Railway** (or another host) connected to this GitHub repo — that dashboard is the operational source of truth for live URLs and env vars.

The `environment.url` in the workflow is informational; confirm it matches your current production URL in Railway settings.

## E2E / browser tests

There is **no** `middleware-platform/cypress/` directory in this repository at present; the CI step **skips** Cypress when the folder is missing. Restoring E2E or documenting manual smoke tests is tracked in the platform backlog.


---

<a id="database-postgres-migration"></a>

## Postgres Migration & Infrastructure Hardening

*Former path: `docs/deployment/database/POSTGRES_MIGRATION.md`*

## Overview

The production roadmap calls for moving from the embedded SQLite database to a managed Azure Database for PostgreSQL instance. This guide introduces:

1. A repeatable export script that converts critical SQLite tables into Postgres-compatible SQL.
2. An Azure Bicep template (`infra/bicep/app-service-with-postgres.bicep`) that provisions an App Service, hosting plan, and Postgres flexible server with matching environment variables.

These assets allow you to bootstrap a managed Postgres environment, seed it with current data, and keep infrastructure reproducible across regions.

---

## 1. Generate a Postgres Seed

The middleware now ships with `scripts/export-sqlite-to-postgres.js`. It emits `CREATE TABLE` statements plus `INSERT` statements for the most sensitive multi-tenant data (clinics, clinic numbers, appointments, voice checkouts/logs, customers).

```bash
cd middleware-platform
npm run export:postgres           # writes backups/postgres-seed-<timestamp>.sql

# or specify a custom path
node scripts/export-sqlite-to-postgres.js /tmp/postgres-seed.sql
```

Upload the generated `.sql` file to your Azure Postgres instance (Azure Cloud Shell, `psql`, or GitHub Actions step) to seed the new database.

> The script is idempotent: it truncates the destination tables before inserting rows, making it safe for nightly refreshes during migration testing.

---

## 2. Provision Infra via Bicep

The new template lives at `infra/bicep/app-service-with-postgres.bicep` and creates:

- An App Service Plan (`B1` by default)
- A Linux App Service configured for Node 20
- A Flexible Server for PostgreSQL with public networking disabled by default
- App Settings for `POSTGRES_URL`, `RETELL_API_KEY`, `TWILIO_*`, etc.

### Parameters

| Parameter          | Description                               |
|--------------------|-------------------------------------------|
| `namePrefix`       | Base name for all Azure resources         |
| `location`         | Azure region (defaults to `westus2`)      |
| `postgresSku`      | Flexible server SKU (`Standard_B1ms`, …)  |
| `appServiceSku`    | App Service plan SKU (`B1`, `P1v3`, …)    |
| `adminLogin`       | Postgres admin username                   |
| `adminPassword`    | Postgres admin password (secure string)   |

### Deployment Command

```bash
cd infra/bicep
az deployment group create \
  --name voice-agent-hardened \
  --resource-group <rg> \
  --template-file app-service-with-postgres.bicep \
  --parameters namePrefix=doclittle \
               adminLogin=doclittle_admin \
               adminPassword=<secure-password>
```

This emits outputs for `appServiceUrl`, `postgresHost`, and `connectionString` that can be copied into GitHub secrets or Azure DevOps pipelines.

---

## 3. Cutover Checklist

1. **Run nightly exports** using `npm run export:postgres`.
2. **Load seed file** into the Azure Postgres flexible server (via `psql -f postgres-seed.sql`).
3. **Update App Settings** in App Service: set `POSTGRES_URL` to enable write-through mirroring (clinics, appointments, voice checkouts/logs). The middleware still reads from SQLite today, but every write is mirrored into Postgres so you can validate data correctness before a full flip.
4. **Verify telemetry** using Application Insights and the existing cost dashboards.
5. **Disable SQLite** once confidence is high (remove fallback envs, lock down file-based DB).

---

## Future Work

- Introduce a runtime DB abstraction so the middleware can switch between SQLite and Postgres via env flag.
- Expand read-path support so the API uses Postgres directly once `POSTGRES_URL` is set (currently writes are mirrored; reads still come from SQLite).
- Add GitHub Actions workflow that runs Bicep deployments + database exports on demand.
- Mirror infrastructure definitions for Twilio sub-accounts / phone-number provisioning once Azure Resource Graph adds support.

For now, the combination of the export script and the Bicep template gives the team a solid foundation for managed storage plus reproducible infrastructure. Use this guide as the canonical runbook for the “Harden data + infra” initiative.



---

<a id="database-postgres-testing"></a>

## Postgres Testing Guide

*Former path: `docs/deployment/database/POSTGRES_TESTING.md`*

This guide explains how to test the Postgres routing implementation.

## Prerequisites

1. **Postgres Database**: You need a Postgres database (version 12+) accessible via connection string
2. **Connection String Format**: `postgresql://username:password@host:port/database?sslmode=require`

## Local Testing

### Option 1: Docker Postgres

```bash
# Start a local Postgres container
docker run --name test-postgres \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  -d postgres:15

# Run the test
POSTGRES_URL=postgresql://postgres:testpass@localhost:5432/testdb \
  node middleware-platform/tests/test-postgres-routing.js
```

### Option 2: Azure Postgres (via Bicep)

1. Deploy infrastructure using the Bicep template:
   ```bash
   az deployment group create \
     --resource-group rg-doclittle-test \
     --template-file infra/bicep/app-service-with-postgres.bicep \
     --parameters \
       namePrefix=doclittle-test \
       location=westus2 \
       adminLogin=adminuser \
       adminPassword=YourSecurePassword123! \
       appServiceSku=B1 \
       postgresSku=Standard_B1ms
   ```

2. Get the connection string from outputs:
   ```bash
   az deployment group show \
     --resource-group rg-doclittle-test \
     --name app-service-with-postgres \
     --query properties.outputs.connectionString.value
   ```

3. Run the test:
   ```bash
   POSTGRES_URL="<connection-string-from-output>" \
     node middleware-platform/tests/test-postgres-routing.js
   ```

## Running the Test

```bash
# From the middleware-platform directory
cd middleware-platform
POSTGRES_URL=postgresql://user:pass@host:5432/dbname \
  node tests/test-postgres-routing.js

# Or from the project root
POSTGRES_URL=postgresql://user:pass@host:5432/dbname \
  node middleware-platform/tests/test-postgres-routing.js
```

## What the Test Does

The test verifies that all critical database methods correctly route to Postgres:

1. ✅ **Clinic Operations**: Create, retrieve by ID
2. ✅ **Appointment Operations**: Create, retrieve, search by date, search by phone
3. ✅ **Voice Checkout Operations**: Create, retrieve, update
4. ✅ **Logging Operations**: Voice call logging, function call logging

## Expected Output

```
🗄️  Postgres Routing Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Postgres URL: postgresql://user:****@host:5432/dbname

📋 Test 1: Creating clinic...
✅ Clinic created

📋 Test 2: Retrieving clinic...
✅ Clinic retrieved: Postgres Test Clinic

... (all tests pass)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 All Postgres routing tests passed!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Troubleshooting

### Connection Errors

- **Error: Connection refused**: Check that Postgres is running and accessible
- **Error: Authentication failed**: Verify username/password in connection string
- **Error: Database does not exist**: Create the database first: `CREATE DATABASE testdb;`

### SSL Errors

If using local Postgres without SSL:
```bash
POSTGRES_URL=postgresql://user:pass@localhost:5432/dbname?sslmode=disable
```

### Schema Issues

The test assumes the database schema is already created. If you're using a fresh database, you'll need to run migrations first. The schema is created automatically when the app starts with `POSTGRES_URL` set.

## Next Steps

After successful testing:

1. **Deploy to Staging**: Use the Bicep template to deploy infrastructure
2. **Run Migrations**: Execute database migrations on the Postgres instance
3. **Update App Service**: Set `POSTGRES_URL` environment variable in Azure App Service
4. **Monitor**: Check application logs to ensure Postgres routing is working



---

<a id="dns-dns-records-to-add"></a>

## DNS Records to Add for Tenant Subdomains

*Former path: `docs/deployment/dns/DNS_RECORDS_TO_ADD.md`*

## Current DNS Status

From your IONOS DNS settings, you have:
- ✅ `api` CNAME → `doclittle.azurewebsites.net` (working)
- ✅ Wildcard `*` CNAME → Azure email domain key (for email/DKIM)
- ✅ A records for `@` and `www` → `20.115.232.16`

## Missing Records

You need to add CNAME records for each tenant subdomain:

---

## 📋 Records to Add

### 1. For `akin-dunbar` (if not already working)

**CNAME Record:**
```
Type: CNAME
Host Name: akin-dunbar
Value: doclittle.azurewebsites.net
TTL: 3600 (or default)
```

**Why**: This routes `akin-dunbar.api.callsomo.com` to your Azure App Service.

---

### 2. For `doctor-little` (new tenant)

**CNAME Record:**
```
Type: CNAME
Host Name: doctor-little
Value: doclittle.azurewebsites.net
TTL: 3600 (or default)
```

**Why**: This routes `doctor-little.api.callsomo.com` to your Azure App Service.

---

## 🎯 How to Add in IONOS

1. Go to: https://my.ionos.com/domain-dns-settings/api.callsomo.com
2. Click **"Add record"** button (top right)
3. Fill in:
   - **Type**: Select `CNAME`
   - **Host Name**: Enter `doctor-little` (or `akin-dunbar`)
   - **Value**: Enter `doclittle.azurewebsites.net`
   - **TTL**: Leave default or set to `3600`
4. Click **Save**
5. Wait 5-30 minutes for DNS propagation

---

## ✅ Verification

After adding the CNAME record, verify it:

```bash
# Check DNS propagation
dig doctor-little.api.callsomo.com CNAME

# Should show:
# doctor-little.api.callsomo.com. 3600 IN CNAME doclittle.azurewebsites.net.
```

---

## 🔍 Why `akin-dunbar` Might Be Working

If `akin-dunbar.api.callsomo.com` is working but you don't see a CNAME record, it might be:

1. **Using the A record** - But this would only work for root domain, not subdomains
2. **Configured directly in Azure** - Azure might be handling it differently
3. **Actually not working with HTTPS** - Might be HTTP only or have SSL errors

**Check if `akin-dunbar` actually works:**
```bash
curl -I https://akin-dunbar.api.callsomo.com
# If you get SSL errors, it needs the CNAME + SSL certificate
```

---

## 📊 Complete DNS Setup for Multi-Tenant

For a proper multi-tenant setup, you'll need:

| Host Name | Type | Value | Purpose |
|-----------|------|-------|---------|
| `@` | A | `20.115.232.16` | Root domain |
| `www` | A | `20.115.232.16` | WWW subdomain |
| `api` | CNAME | `doclittle.azurewebsites.net` | API subdomain ✅ |
| `akin-dunbar` | CNAME | `doclittle.azurewebsites.net` | Tenant 1 ⚠️ |
| `doctor-little` | CNAME | `doclittle.azurewebsites.net` | Tenant 2 ⚠️ |
| `*` | CNAME | `(Azure email key)` | Email/DKIM ✅ |

**Note**: The wildcard `*` CNAME is for email, not subdomain routing. Each tenant needs its own CNAME record.

---

## 🚀 Next Steps After Adding DNS

1. **Add custom domain in Azure** (if not already done):
   ```bash
   az webapp config hostname add \
     --resource-group doclittle \
     --webapp-name doclittle \
     --hostname doctor-little.api.callsomo.com
   ```

2. **Wait for DNS propagation** (5-30 minutes)

3. **Create SSL certificate**:
   ```bash
   az webapp config ssl create \
     --resource-group doclittle \
     --name doclittle \
     --hostname doctor-little.api.callsomo.com
   ```

4. **Bind SSL certificate** (see [TENANT_AND_DNS_SETUP.md](./TENANT_AND_DNS_SETUP.md))

---

**Last Updated**: December 2024




---

<a id="dns-ionos-ionos-dns-setup"></a>

## IONOS DNS Setup — api.callsomo.com

*Former path: `docs/deployment/dns/ionos/IONOS_DNS_SETUP.md`*

**Last Updated:** April 6, 2026

Merged from: IONOS_A_RECORD_SETUP, IONOS_DNS_CONFIGURATION.

---

## 1. Root Domain (A Record)

### Get Azure IP
```bash
az webapp show --name doclittle --resource-group doclittle \
  --query "outboundIpAddresses" --output tsv
# Use first IP (e.g. 20.99.227.36)
```

### IONOS Configuration
1. Go to https://my.ionos.com/domain-dns-settings/api.callsomo.com
2. Add **A Record**: Type `A`, Name `@`, Value `<Azure IP>`, TTL `3600`
3. Save

**Do NOT delete:** `api` CNAME, MX, TXT, `_domainkey` records.

### Verify
```bash
dig api.callsomo.com
# Should show Azure IP
```

### Add in Azure
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname api.callsomo.com
```

---

## 2. API Subdomain (CNAME)

- `api` → `doclittle.azurewebsites.net` (for api.api.callsomo.com)

---

## 3. Tenant Subdomains

See [TENANT_AND_DNS_SETUP.md](../TENANT_AND_DNS_SETUP.md) for adding tenant subdomains (e.g. `doctor-little.api.callsomo.com`).


---

<a id="dns-ssl-doclittle-site-ssl-setup"></a>

## api.callsomo.com SSL & Domain Setup

*Former path: `docs/deployment/dns/ssl/DOCLITTLE_SITE_SSL_SETUP.md`*

## Current Status
- ✅ `api.api.callsomo.com` is configured and working with SSL
- ❌ `api.callsomo.com` (root domain) is NOT configured yet
- ❌ SSL certificate not created for root domain

---

## Step 1: Add Azure Verification TXT Record in IONOS

**REQUIRED** - Azure needs this to verify domain ownership before adding the domain.

### IONOS DNS Configuration

1. **Log in to IONOS:** https://www.ionos.com
2. **Go to DNS Settings:** https://my.ionos.com/domain-dns-settings/api.callsomo.com
3. **Add TXT Record:**

   **Configuration:**
   - **Type:** `TXT`
   - **Name:** `asuid.api.callsomo.com` (or just `asuid` if IONOS adds `.api.callsomo.com` automatically)
   - **Value:** `e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2`
   - **TTL:** `3600` (or default)

4. **Save** the record

**Visual Guide:**
```
Type:     [TXT ▼]
Name:     [asuid.api.callsomo.com]
Value:    [e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2]
TTL:      [3600]
```

**Note:** This is different from the `asuid.api` TXT record. You need BOTH:
- `asuid.api` → Already exists (for api.api.callsomo.com)
- `asuid.api.callsomo.com` → **NEW** (for root domain)

---

## Step 2: Wait for DNS Propagation

**Wait 5-15 minutes** for the TXT record to propagate.

**Verify TXT record:**
```bash
dig TXT asuid.api.callsomo.com +short
```

**Expected output:**
```
"e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2"
```

Or use online tool:
https://dnschecker.org/#TXT/asuid.api.callsomo.com

---

## Step 3: Add Domain in Azure (After TXT Record Propagates)

Once the TXT record is verified, add the domain:

```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname api.callsomo.com
```

**Expected Output:**
```
{
  "name": "api.callsomo.com",
  "slot": "production"
}
```

---

## Step 4: Create App Service Managed SSL Certificate

Azure will automatically create and manage the SSL certificate:

```bash
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname api.callsomo.com
```

**Note:** This may take 10-30 minutes. Azure needs to:
1. Verify domain ownership (TXT record)
2. Request certificate from Certificate Authority
3. Issue and install certificate

---

## Step 5: Bind SSL Certificate (After Certificate is Created)

**Check certificate status:**
```bash
az webapp config ssl list \
  --resource-group doclittle \
  --query "[?name=='api.callsomo.com']" \
  --output table
```

**Wait for status to be `Issued`**, then bind:

```bash
# Get certificate thumbprint
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --name doclittle \
  --certificate-name api.callsomo.com \
  --query thumbprint \
  --output tsv)

# Bind certificate
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint "$THUMBPRINT" \
  --ssl-type SNI \
  --hostname api.callsomo.com
```

---

## Step 6: Verify SSL is Working

**Test HTTPS:**
```bash
curl -I https://api.callsomo.com
```

**Expected:**
```
HTTP/2 200
...
```

**In Browser:**
- Visit: https://api.callsomo.com
- Should show green padlock (valid SSL)
- No SSL warnings

---

## Quick Reference

### TXT Record to Add (IONOS)
```
Type: TXT
Name: asuid.api.callsomo.com
Value: e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2
```

### Commands (Run in order after TXT record propagates)
```bash
# 1. Add domain
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname api.callsomo.com

# 2. Create SSL certificate
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname api.callsomo.com

# 3. Wait 10-30 minutes, then check status
az webapp config ssl list \
  --resource-group doclittle \
  --query "[?name=='api.callsomo.com']"

# 4. Bind certificate (after status is "Issued")
THUMBPRINT=$(az webapp config ssl show \
  --resource-group doclittle \
  --name doclittle \
  --certificate-name api.callsomo.com \
  --query thumbprint --output tsv)

az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint "$THUMBPRINT" \
  --ssl-type SNI \
  --hostname api.callsomo.com
```

---

## Troubleshooting

### Error: "TXT record not found"
**Solution:** 
- Wait 5-15 minutes after adding TXT record
- Verify with: `dig TXT asuid.api.callsomo.com`
- Check IONOS saved the record correctly

### Certificate Status Stays "PendingIssuance"
**Solution:**
- Wait up to 30 minutes (can take time)
- Verify TXT record still exists
- Check Azure App Service logs: `az webapp log tail --name doclittle --resource-group doclittle`

### Domain Added but SSL Not Working
**Solution:**
- Verify certificate is created: `az webapp config ssl list`
- Check certificate is bound to domain
- Wait for SSL to propagate (can take 5-10 minutes after binding)

---

## Current DNS Records Summary

**Should have these records in IONOS:**

| Type | Name | Value | Status |
|------|------|-------|--------|
| A | `@` | `20.99.227.36` | ✅ Exists |
| CNAME | `api` | `doclittle.azurewebsites.net` | ✅ Exists |
| TXT | `asuid.api` | `e81a8b...` | ✅ Exists |
| **TXT** | **`asuid.api.callsomo.com`** | **`e81a8b...`** | **❌ NEED TO ADD** |

---

**Status:** ⏳ Waiting for TXT record to be added in IONOS  
**Next Step:** Add `asuid.api.callsomo.com` TXT record in IONOS DNS settings



---

<a id="dns-tenant-and-dns-setup"></a>

## Tenant Subdomain & DNS Setup

*Former path: `docs/deployment/dns/TENANT_AND_DNS_SETUP.md`*

**Last Updated:** April 6, 2026

Merged from: TENANT_SUBDOMAIN_SETUP, SUBDOMAIN_SSL_FIX, WILDCARD_DNS_EXPLANATION.

---

## 1. Overview

For each tenant subdomain (e.g. `doctor-little.api.callsomo.com`):

1. Add CNAME in IONOS
2. Add custom domain in Azure
3. Create SSL certificate
4. Bind SSL certificate

**Automated:** `./scripts/add-tenant-subdomain.sh doctor-little`

---

## 2. Wildcard DNS vs Azure Custom Domains

**Wildcard CNAME** (`* → doclittle.azurewebsites.net`) routes all subdomains to Azure but:
- ❌ Does NOT add subdomains as custom domains in Azure
- ❌ Does NOT create SSL certificates

**Each subdomain must be added in Azure** and needs its own SSL cert (or wildcard cert).

---

## 3. Manual Steps

### CNAME in IONOS
- Name: `doctor-little`
- Value: `doclittle.azurewebsites.net`

### Add Domain in Azure
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname doctor-little.api.callsomo.com
```

### SSL Certificate
```bash
az webapp config ssl create --resource-group doclittle --name doclittle \
  --hostname doctor-little.api.callsomo.com
az webapp config ssl bind --resource-group doclittle --name doclittle \
  --certificate-thumbprint <THUMBPRINT> --ssl-type SNI \
  --hostname doctor-little.api.callsomo.com
```

---

## 4. SSL Fix (NET::ERR_CERT_COMMON_NAME_INVALID)

**Options:**
1. **Cloudflare** — Provides free SSL for all subdomains; point nameservers to Cloudflare
2. **Azure Wildcard** — Purchase/upload `*.api.callsomo.com` cert
3. **Per-subdomain** — Create and bind cert per tenant (as above)

---

## 5. Related

- [IONOS_DNS_SETUP](./ionos/IONOS_DNS_SETUP.md)
- [AUTOMATED_TENANT_DOMAIN_SETUP](../README.md#azure-automated-tenant-domain-setup)


---

<a id="guides-advanced-ci-cd-setup"></a>

## CI/CD Setup for Infrastructure Deployment

*Former path: `docs/deployment/guides/advanced/CI_CD_SETUP.md`*

This guide explains how to use the GitHub Actions workflow to deploy infrastructure using Bicep templates.

## Overview

The `.github/workflows/deploy-infrastructure.yml` workflow automates the deployment of:
- Azure App Service Plan
- Azure App Service (Node.js 20)
- Azure Database for PostgreSQL Flexible Server
- Database and connection configuration

## Prerequisites

### 1. Azure Service Principal

Create an Azure service principal with Contributor role:

```bash
az ad sp create-for-rbac \
  --name "github-actions-doclittle" \
  --role Contributor \
  --scopes /subscriptions/{subscription-id} \
  --sdk-auth
```

Save the JSON output - you'll need it for GitHub secrets.

### 2. GitHub Secrets

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

| Secret Name | Description | Example |
|------------|-------------|---------|
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | `12345678-1234-1234-1234-123456789012` |
| `AZURE_TENANT_ID` | Azure tenant ID | `87654321-4321-4321-4321-210987654321` |
| `AZURE_CLIENT_ID` | Service principal client ID | `abcd1234-5678-90ef-ghij-klmnopqrstuv` |
| `AZURE_CLIENT_SECRET` | Service principal client secret | `your-secret-key` |
| `POSTGRES_ADMIN_LOGIN` | Postgres admin username | `adminuser` |
| `POSTGRES_ADMIN_PASSWORD` | Postgres admin password | `YourSecurePassword123!` |

## Usage

### Manual Deployment (Workflow Dispatch)

1. Go to **Actions** tab in GitHub
2. Select **Deploy Infrastructure** workflow
3. Click **Run workflow**
4. Fill in the parameters:
   - **Environment**: `staging` or `production`
   - **Name prefix**: Resource name prefix (e.g., `doclittle`)
   - **Location**: Azure region (e.g., `westus2`)
5. Click **Run workflow**

### Automatic Deployment (Push to main)

The workflow automatically runs when:
- Code is pushed to `main` branch
- Files in `infra/bicep/` are modified
- The workflow file itself is updated

## Workflow Steps

1. **Checkout code**: Gets the latest code from repository
2. **Azure Login**: Authenticates using service principal
3. **Set deployment variables**: Configures environment-specific settings
4. **Create resource group**: Creates or updates Azure resource group
5. **Deploy Bicep template**: Provisions all infrastructure resources
6. **Get deployment outputs**: Retrieves connection strings and URLs
7. **Display results**: Shows deployment summary

## Outputs

After successful deployment, the workflow outputs:

- **App Service URL**: `https://{name-prefix}-{env}-api.azurewebsites.net`
- **Postgres Host**: `{name-prefix}-{env}-pg.postgres.database.azure.com`
- **Connection String**: Full Postgres connection string (masked in logs)

## Post-Deployment Steps

### 1. Configure App Service Environment Variables

The Bicep template sets `POSTGRES_URL` but you may need to update other variables:

```bash
az webapp config appsettings set \
  --resource-group rg-{name-prefix}-{env} \
  --name {name-prefix}-{env}-api \
  --settings \
    RETELL_API_KEY="your-key" \
    TWILIO_ACCOUNT_SID="your-sid" \
    TWILIO_AUTH_TOKEN="your-token" \
    DEFAULT_CLINIC_ID="clinic-default"
```

### 2. Run Database Migrations

Connect to Postgres and run the schema creation:

```bash
# Get connection string
az deployment group show \
  --resource-group rg-{name-prefix}-{env} \
  --name app-service-with-postgres \
  --query properties.outputs.connectionString.value

# Connect and run migrations
psql "{connection-string}" -f middleware-platform/scripts/schema.sql
```

### 3. Seed Initial Data (Optional)

If you have existing SQLite data:

```bash
# Export from SQLite
cd middleware-platform
npm run export:postgres

# Import to Postgres
psql "{connection-string}" -f backups/postgres-seed-*.sql
```

### 4. Deploy Application Code

Deploy your application to the App Service:

```bash
# Using ZIP deployment
az webapp deployment source config-zip \
  --resource-group rg-{name-prefix}-{env} \
  --name {name-prefix}-{env}-api \
  --src deploy.zip
```

## Environment-Specific Configuration

### Staging

- Resource group: `rg-doclittle-staging`
- App Service: `doclittle-staging-api`
- Postgres: `doclittle-staging-pg`

### Production

- Resource group: `rg-doclittle-production`
- App Service: `doclittle-production-api`
- Postgres: `doclittle-production-pg`

## Troubleshooting

### Deployment Fails

1. **Check Azure permissions**: Ensure service principal has Contributor role
2. **Verify secrets**: All required secrets must be set in GitHub
3. **Check resource limits**: Ensure subscription has quota for resources
4. **Review logs**: Check workflow logs for specific error messages

### Connection Issues

1. **Postgres networking**: By default, public access is disabled. Enable if needed:
   ```bash
   az postgres flexible-server firewall-rule create \
     --resource-group rg-{name-prefix}-{env} \
     --name {name-prefix}-{env}-pg \
     --rule-name AllowAzureServices \
     --start-ip-address 0.0.0.0 \
     --end-ip-address 0.0.0.0
   ```

2. **SSL requirements**: Connection string includes `sslmode=require` - ensure SSL is enabled

### App Service Not Starting

1. **Check logs**: `az webapp log tail --name {name} --resource-group {rg}`
2. **Verify environment variables**: Ensure `POSTGRES_URL` is set correctly
3. **Check application code**: Ensure code is deployed and compatible

## Security Best Practices

1. **Use Key Vault**: Store sensitive values in Azure Key Vault instead of App Settings
2. **Rotate credentials**: Regularly rotate Postgres admin password
3. **Network isolation**: Use VNet integration for App Service to Postgres communication
4. **Private endpoints**: Configure private endpoints for Postgres in production
5. **RBAC**: Use least-privilege access for service principal

## Cost Optimization

- **Staging**: Use `B1` App Service and `Standard_B1ms` Postgres (lowest cost)
- **Production**: Scale up based on traffic (`P1v3` App Service, `Standard_B2s` Postgres)
- **Auto-shutdown**: Consider auto-shutdown for non-production environments

## Next Steps

1. Set up monitoring and alerts
2. Configure backup policies for Postgres
3. Set up staging → production promotion workflow
4. Add integration tests to CI/CD pipeline
5. Configure DNS and SSL certificates



---

<a id="guides-advanced-deployment-checklist"></a>

## Deployment Checklist - Language Detection Fix

*Former path: `docs/deployment/guides/advanced/DEPLOYMENT_CHECKLIST.md`*

## Changes Made

1. **Code Changes:**
   - `middleware-platform/services/retell-service.js` - Updated default prompt to include automatic language detection

2. **Prompt File Changes:**
   - `docs/voice-agent/prompts/kelly-voice-agent-prompt.md` - Updated to require automatic language detection

## ⚠️ Critical Issue Found

**The deployment script excludes `*.md` files!**

Looking at `scripts/deploy-to-azure.sh` line 75:
```bash
-x "*.md" \
```

This means the prompt file `docs/voice-agent/prompts/kelly-voice-agent-prompt.md` **will NOT be deployed** to Azure.

## Impact

1. **New agents created after deployment:**
   - Will fail to load the prompt file (file won't exist on Azure)
   - Will fall back to `getDefaultPrompt()` which has the updated language detection instructions
   - ✅ **This will work** - the fallback prompt includes the fix

2. **Existing agents:**
   - Already have the old prompt stored in Retell's system
   - Need to be updated via Retell API to get the new prompt
   - Or can be updated manually via Retell dashboard

## Deployment Steps

### Option 1: Deploy Code Only (Recommended - Quick Fix)

The code changes will work because:
- New agents will use `getDefaultPrompt()` which includes the language detection fix
- The fallback prompt has the updated instructions

**Steps:**
1. Deploy code changes:
   ```bash
   ./scripts/deploy-to-azure.sh
   ```

2. Update existing agents via Retell API or dashboard:
   - Use `updateAgent()` method or Retell dashboard
   - Update the `general_prompt` with the new language detection instructions

### Option 2: Fix Deployment Script + Deploy Everything (Better Long-term)

**Fix the deployment script to include prompt files:**

Edit `scripts/deploy-to-azure.sh` line 75:
```bash
# Change from:
-x "*.md" \

# To:
-x "*.md" \
! -path "docs/voice-agent/*.md" \
```

Or better yet, explicitly include the docs folder:
```bash
# Remove the blanket *.md exclusion and be more specific
-x "README.md" \
-x "CHANGELOG.md" \
# But keep docs/voice-agent/*.md
```

**Then deploy:**
```bash
./scripts/deploy-to-azure.sh
```

## What Needs to Happen

### Immediate (Required):
1. ✅ **Deploy code changes** - The `retell-service.js` changes need to be on Azure
   - Run: `./scripts/deploy-to-azure.sh`

### For Existing Agents (Optional but Recommended):
2. **Update existing Retell agents** to use the new prompt:
   - Option A: Use Retell dashboard to manually update the prompt
   - Option B: Create a script to call `updateAgent()` for all existing agents
   - Option C: Wait for agents to be recreated (they'll get the new prompt automatically)

### Long-term (Recommended):
3. **Fix deployment script** to include prompt files for future deployments

## Testing After Deployment

1. **Test new agent creation:**
   - Create a new clinic/agent
   - Verify it uses the updated prompt (check Retell dashboard)

2. **Test language detection:**
   - Call the agent and speak in Russian
   - Verify it automatically detects and responds in Russian

3. **Test existing agents:**
   - If you updated existing agents, test them too
   - If not, they'll continue using the old prompt until updated

## Summary

**YES, you need to deploy to Azure:**
- ✅ Code changes in `retell-service.js` must be deployed
- ⚠️ Prompt file won't be deployed (excluded by script), but fallback prompt has the fix
- ✅ New agents will work with the fix (via fallback prompt)
- ⚠️ Existing agents need manual update via Retell API/dashboard

**Quick action:** Just deploy the code - it will work for new agents. Update existing agents separately if needed.



---

<a id="guides-advanced-signup-flow-implementation"></a>

## Signup Flow Implementation - api.api.callsomo.com

*Former path: `docs/deployment/guides/advanced/SIGNUP_FLOW_IMPLEMENTATION.md`*

## ✅ Implementation Complete

### Overview
Completely rebuilt the signup and authentication flow for `api.api.callsomo.com`:

- ✅ **Root endpoint (`/`)**: Now serves signup page (removed JSON metadata - moved to `/api`)
- ✅ **Removed admin portal** from `api.api.callsomo.com/admin` (will be on `api.callsomo.com/admin` later)
- ✅ **Email verification** required before accessing docs
- ✅ **Terms of Service** acceptance required
- ✅ **API key creation** in `/docs` (only when user clicks "Create API Key")
- ✅ **Per-customer usage tracking** via `customer_id` in all API calls

---

## 🎯 User Flow

**Specialist Provider Portal** (individual medical specialists; no company signup)

```
User visits signup page (e.g. api.api.callsomo.com or unified-dashboard)
  ↓
Signup Page (Step 1) — Provider details
  - First name, Last name, Work email, Phone (required)
  - Location: City, Postal/Zip code, Country
  - Medical specialty, License number, License state (required)
  - License document (PDF only, optional), Photo (optional), Languages
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
   - Test signup flow: `https://api.api.callsomo.com`
   - Test email verification (check email)
   - Test terms acceptance: `https://api.api.callsomo.com/terms`
   - Test docs protection: `https://api.api.callsomo.com/docs` (should redirect if not authenticated)
   - Test API key creation in docs

5. **Test API key authentication:**
   ```bash
   curl -X POST https://api.api.callsomo.com/voice/products/search \
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
- [ ] Admin portal removed from `api.api.callsomo.com/admin`

---

## 🔄 Next Steps (Future)

1. **Admin Portal on `api.callsomo.com/admin`**
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

- **Provider Signup Requirements**: `docs/compliance/README.md#provider-signup-requirements`
- **Healthcare Legal Requirements**: `docs/compliance/README.md#healthcare-legal-requirements`
- **Terms of Service**: `docs/legal/TERMS_OF_SERVICE.md`
- **Data Retention**: `docs/compliance/README.md#data-retention-policy`
- **API Documentation**: `docs/api/README.md#api-documentation` (will need update)
- **Deployment Guide**: `docs/deployment/README.md#guides-deployment-guide`

---

**Status:** ✅ Ready for Production Deployment  
**Last Updated:** January 2025



---

<a id="guides-backup-strategy"></a>

## Database Backup Strategy

*Former path: `docs/deployment/guides/BACKUP_STRATEGY.md`*

## Overview

The platform includes automated database backup functionality to protect against data loss.

## Manual Backup

To create a backup manually:

```bash
cd middleware-platform
npm run backup
```

Or directly:

```bash
node scripts/backup-database.js
```

This will create a timestamped backup file in the `backups/` directory:
- Format: `middleware-backup-YYYY-MM-DDTHH-MM-SS-sssZ.db`
- Location: `middleware-platform/backups/`

## Automated Backups

### Using Cron (Linux/macOS)

Set up a daily backup at 2 AM:

```bash
# Edit crontab
crontab -e

# Add this line:
0 2 * * * cd /path/to/middleware-platform && node scripts/backup-database.js --auto
```

The `--auto` flag:
- Automatically cleans up backups older than 30 days
- Runs silently (no interactive prompts)

### Using Systemd Timer (Linux)

Create a systemd service file:

```ini
# /etc/systemd/system/middleware-backup.service
[Unit]
Description=Middleware Platform Database Backup
After=network.target

[Service]
Type=oneshot
User=your-user
WorkingDirectory=/path/to/middleware-platform
ExecStart=/usr/bin/node scripts/backup-database.js --auto
```

Create a timer file:

```ini
# /etc/systemd/system/middleware-backup.timer
[Unit]
Description=Daily Database Backup Timer
Requires=middleware-backup.service

[Timer]
OnCalendar=daily
OnCalendar=02:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:

```bash
sudo systemctl enable middleware-backup.timer
sudo systemctl start middleware-backup.timer
```

### Using Railway Scheduled Tasks

If deploying on Railway, you can use Railway's cron jobs:

1. Go to your Railway project
2. Add a new service
3. Use the Dockerfile or Nixpacks
4. Set the command to: `node scripts/backup-database.js --auto`
5. Configure a cron schedule: `0 2 * * *` (daily at 2 AM)

### Using GitHub Actions

You can also set up automated backups via GitHub Actions:

```yaml
# .github/workflows/backup.yml
name: Daily Database Backup

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:  # Allow manual trigger

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
      - name: Create backup
        run: |
          cd middleware-platform
          npm install
          node scripts/backup-database.js --auto
      - name: Upload backup artifact
        uses: actions/upload-artifact@v4
        with:
          name: database-backup
          path: middleware-platform/backups/*.db
          retention-days: 30
```

## Backup Retention

- **Manual backups**: Kept indefinitely (you manage them)
- **Automated backups** (`--auto` flag): Automatically deleted after 30 days

## Backup Storage

### Local Storage
- Backups are stored in `middleware-platform/backups/`
- Add this directory to `.gitignore` (already included)

### Cloud Storage (Recommended for Production)

For production, consider uploading backups to cloud storage:

1. **AWS S3**:
```bash
# After backup, upload to S3
aws s3 cp backups/middleware-backup-*.db s3://your-bucket/backups/
```

2. **Google Cloud Storage**:
```bash
gsutil cp backups/middleware-backup-*.db gs://your-bucket/backups/
```

3. **Azure Blob Storage**:
```bash
az storage blob upload --container-name backups --file backups/middleware-backup-*.db
```

### Enhanced Backup Script (Future)

You can extend the backup script to:
- Upload to cloud storage automatically
- Encrypt backups before storage
- Send notifications on backup success/failure
- Compress backups (SQLite databases compress well)

## Restoring from Backup

To restore a backup:

```bash
# Stop the application
# Copy backup over database
cp backups/middleware-backup-YYYY-MM-DDTHH-MM-SS-sssZ.db middleware.db

# Restart the application
```

**⚠️ Warning**: Restoring will overwrite the current database. Make a backup first!

## Monitoring

Monitor backup success:

1. **Check backup directory**:
```bash
ls -lh middleware-platform/backups/
```

2. **Check backup age**:
```bash
find middleware-platform/backups/ -name "*.db" -mtime -1
```

3. **Set up alerts** (if using cron/systemd):
   - Email on backup failure
   - Log to monitoring system
   - Check backup file size (should be > 0)

## Best Practices

1. **Test restores regularly**: Periodically test restoring from backups
2. **Multiple locations**: Store backups in multiple locations (local + cloud)
3. **Encryption**: Encrypt backups containing sensitive data
4. **Monitoring**: Set up alerts for backup failures
5. **Documentation**: Document your backup and restore procedures
6. **Retention policy**: Define how long to keep backups based on your needs

## Troubleshooting

### Backup fails with "Database file not found"
- Check that `middleware.db` exists in `middleware-platform/`
- Verify the database path in the script

### Backups directory not created
- Check file permissions
- Ensure the script has write access to the parent directory

### Old backups not being cleaned up
- Verify the `--auto` flag is being used
- Check file modification times
- Ensure the cleanup function has proper error handling



---

<a id="guides-basic-quick-deployment-guide"></a>

## Quick Deployment Guide - Azure App Service

*Former path: `docs/deployment/guides/basic/QUICK_DEPLOYMENT_GUIDE.md`*

**Last Updated**: December 2024  
**Status**: Production Ready

> **Note**: This is a quick reference. For complete deployment guide, see [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md)

## 🚀 Deploy api.callsomo.com to Azure (Demo Ready)

### Prerequisites
- Azure CLI installed
- Logged in to Azure: `az login`
- Domain `api.callsomo.com` managed in IONOS

---

## Step 1: Deploy Code (Includes Frontend + Backend)

```bash
cd /path/to/somo
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**What this does:**
- ✅ Packages `middleware-platform` (backend + API)
- ✅ Includes `unified-dashboard` (frontend)
- ✅ Deploys to Azure App Service `doclittle`
- ✅ Excludes node_modules (Azure installs them)

---

## Step 2: Add Root Domain to Azure

```bash
chmod +x scripts/add-root-domain.sh
./scripts/add-root-domain.sh
```

**Or manually:**
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname api.callsomo.com
```

---

## Step 3: Configure DNS in IONOS

1. Go to: https://my.ionos.com/domain-dns-settings/api.callsomo.com
2. Click **"Add record"**
3. Add **A Record** (or **ALIAS** if supported):

   **For A Record:**
   - **Type:** A
   - **Name/Host:** `@` (or leave blank)
   - **Value/IP:** Get from Azure Portal → App Service `doclittle` → Properties → Outbound IP addresses (use first IP)
   - **TTL:** 3600 (or default)

   **OR for ALIAS (if supported):**
   - **Type:** ALIAS
   - **Name/Host:** `@`
   - **Value:** `doclittle.azurewebsites.net`
   - **TTL:** 3600

4. Click **Save**
5. Wait 5-30 minutes for DNS propagation

**Verify DNS:**
```bash
dig api.callsomo.com
# Should show Azure App Service IP or azurewebsites.net
```

---

## Step 4: Create SSL Certificate

**After DNS propagates (check with `dig api.callsomo.com`):**

```bash
# Create managed certificate (free)
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname api.callsomo.com

# Get certificate thumbprint
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name api.callsomo.com \
  --query thumbprint \
  --output tsv

# Bind certificate (replace <THUMBPRINT> with output above)
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --hostname api.callsomo.com
```

---

## Step 5: Verify Deployment

### Test URLs:

```bash
# Root domain - should show landing page
curl https://api.callsomo.com

# API subdomain - should show signup page
curl https://api.api.callsomo.com

# Health check
curl https://api.api.callsomo.com/health

# Admin portal (should be accessible on root domain)
open https://api.callsomo.com/admin
```

### Expected Results:

| URL | Should Show |
|-----|-------------|
| `https://api.callsomo.com` | Landing page (unified-dashboard) |
| `https://api.callsomo.com/login` | Login page |
| `https://api.callsomo.com/admin` | Admin portal |
| `https://api.callsomo.com/business/*` | Business dashboard |
| `https://api.api.callsomo.com` | Signup page |
| `https://api.api.callsomo.com/docs` | API docs (protected) |
| `https://api.api.callsomo.com/health` | `{"status":"ok"}` |

---

## 🔍 Troubleshooting

### DNS Not Resolving

```bash
# Check DNS propagation
dig api.callsomo.com
nslookup api.callsomo.com

# If not resolving, wait 30 minutes and try again
```

### SSL Certificate Not Working

```bash
# Check certificate status
az webapp config ssl list \
  --resource-group doclittle \
  --name doclittle

# Verify DNS first before creating certificate
dig api.callsomo.com
```

### Frontend Not Loading

1. **Check logs:**
   ```bash
   az webapp log tail --name doclittle --resource-group doclittle
   ```

2. **Verify routes in server.js:**
   - Root domain should serve canonical `/` (LittleLab landing build when present)
   - Legacy `/landing` and `/landing.html` should redirect to `/`
   - API subdomain should serve `public/signup/index.html`

3. **Check static files:**
   - Verify `unified-dashboard` is included in deployment
   - Check Azure Portal → Deployment Center → Logs

### 404 Errors

- Verify domain is added: `az webapp config hostname list --resource-group doclittle --webapp-name doclittle`
- Check SSL certificate is bound
- Verify DNS is pointing to correct IP

---

## 📊 Quick Status Check

```bash
# Check App Service status
az webapp show --name doclittle --resource-group doclittle --query state

# List all custom domains
az webapp config hostname list \
  --resource-group doclittle \
  --webapp-name doclittle \
  --output table

# View recent logs
az webapp log tail --name doclittle --resource-group doclittle
```

---

## 🎯 Demo Checklist

Before showing to clients:

- [ ] `https://api.callsomo.com` loads landing page
- [ ] `https://api.callsomo.com/login` works
- [ ] `https://api.callsomo.com/admin` accessible
- [ ] `https://api.api.callsomo.com` shows signup page
- [ ] `https://api.api.callsomo.com/health` returns `{"status":"ok"}`
- [ ] SSL certificates valid (no browser warnings)
- [ ] All static assets load (CSS, JS, images)
- [ ] Frontend connects to `https://api.api.callsomo.com` API

---

## 🔄 Updating Deployment

To update code after changes:

```bash
# Make your changes locally
# Then redeploy:
./scripts/deploy-to-azure.sh
```

Azure will:
1. Upload new code
2. Install dependencies
3. Restart the app
4. Apply changes (usually takes 2-5 minutes)

---

## 📞 Support

**Azure Portal:** https://portal.azure.com
- Navigate to: Resource Groups → doclittle → doclittle

**IONOS DNS:** https://my.ionos.com/domain-dns-settings/api.callsomo.com

**View Logs:**
```bash
az webapp log tail --name doclittle --resource-group doclittle
```

---

**Status:** ✅ Ready for Deployment  
**Last Updated:** January 2025



---

<a id="guides-deployment-guide"></a>

## Deployment Guide

*Former path: `docs/deployment/guides/DEPLOYMENT_GUIDE.md`*

**Last Updated**: January 27, 2025  
**Status**: Ready for Production Deployment

**CI vs Railway:** GitHub Actions runs tests and guardrails; the workflow’s “Deploy” job does not push artifacts by itself. See **[CI_AND_DEPLOY_SOURCE_OF_TRUTH.md](../README.md#ci-and-deploy-source-of-truth)** for how that maps to Railway or other hosts.

---

## 🎯 Quick Deploy

### Option 1: Azure (Current Production) ⚡

```bash
cd /path/to/somo
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**Or push to GitHub** (auto-deploys if connected):
```bash
git push origin main
```

### Quick Steps Summary

1. **Deploy Code**: Run `./scripts/deploy-to-azure.sh`
2. **Add Root Domain**: Run `./scripts/add-root-domain.sh` (or use Azure Portal)
3. **Configure DNS**: Add A record in IONOS pointing to Azure IP
4. **Create SSL**: After DNS propagates, create managed certificate
5. **Configure Subdomain SSL**: See [TENANT_AND_DNS_SETUP.md](../README.md#dns-tenant-and-dns-setup) for tenant subdomains
6. **Verify**: Test all URLs and health endpoints

**⚠️ Important**: Azure managed certificates only cover the root domain. For tenant subdomains (e.g., `doctor-little.api.callsomo.com`), you need either:
- **Cloudflare** (recommended) - automatic SSL for all subdomains
- **Wildcard certificate** - manual setup required

See [TENANT_AND_DNS_SETUP.md](../README.md#dns-tenant-and-dns-setup) for detailed instructions.

See detailed steps below.

---

## 📋 Pre-Deployment Checklist

### ✅ Code Changes
- [x] All hardcoded tenant references removed
- [x] Tenant context middleware created
- [x] Constants file created
- [x] Retell WebSocket uses `clinic_id` consistently
- [x] All changes tested locally
- [x] Invoice billing system implemented
- [x] Multi-tenant routing configured

### ✅ Database Schema
- [x] `merchant_orders` table has all required fields
- [x] `invoices`, `invoice_items`, `invoice_payments` tables created
- [x] `pickup_address`, `pickup_latitude`, `pickup_longitude`, `drop_point` fields
- [x] `delivery_status`, `driver_name`, `driver_phone` fields
- [x] `current_latitude`, `current_longitude`, `current_address` fields
- [x] Migration function adds missing columns on startup

### ✅ Backend API Endpoints
- [x] `POST /api/orders` - Creates orders with pickup/drop point
- [x] `PUT /api/orders/:id` - Updates orders
- [x] `GET /api/orders/:id/tracking` - Gets tracking info
- [x] `POST /api/orders/:id/tracking` - Updates location (with auto-confirm)
- [x] `POST /api/orders/:id/confirm-delivery` - Manual confirmation
- [x] `GET /api/orders/config/maps` - Map provider config
- [x] `POST /api/invoices/create-from-claim` - Create invoice from claim
- [x] `GET /api/invoices` - List invoices with filters
- [x] `POST /api/invoices/:id/send` - Send invoice email
- [x] `POST /api/invoices/:id/payments` - Record payment

### ✅ Services
- [x] Location Verification Service
- [x] Geocoding Service (Nominatim free, Google fallback)
- [x] Delivery Confirmation Service
- [x] Invoice Service with EOB integration
- [x] PDF Invoice Service (optional PDFKit)
- [x] All services have error handling

### ✅ Security
- [x] All order routes require authentication
- [x] Input validation on order creation
- [x] SQL injection protection (parameterized queries)
- [x] Coordinate validation

### ⚠️ Environment Variables to Set

**Required:**
- `NODE_ENV=production`
- `PORT=4000` (or Azure/Railway assigned port)
- `API_BASE_URL=https://api.callsomo.com` (or your domain)
- `BASE_URL=https://api.callsomo.com`

**Optional (for backward compatibility):**
- `DEFAULT_TENANT_SUBDOMAIN=akin-dunbar` (if different from default)

**API Keys (if not already set):**
- `RETELL_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `STRIPE_SECRET_KEY`
- `CIRCLE_API_KEY` (if using USDC)
- `STEDI_API_KEY` (if using insurance)

---

## 🚀 Azure Deployment (Recommended)

### Step 1: Deploy Code

```bash
cd /path/to/somo
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**What this does:**
- ✅ Packages `middleware-platform` (backend + API)
- ✅ Includes `unified-dashboard` (frontend)
- ✅ Deploys to Azure App Service `doclittle`
- ✅ Excludes `node_modules` (Azure installs them)

### Step 1b: Add Root Domain (if not already added)

```bash
chmod +x scripts/add-root-domain.sh
./scripts/add-root-domain.sh
```

**Or manually:**
```bash
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname api.callsomo.com
```

### Step 1c: Configure DNS in IONOS

1. Go to: https://my.ionos.com/domain-dns-settings/api.callsomo.com
2. Click **"Add record"**
3. Add **A Record**:
   - **Type:** A
   - **Name/Host:** `@` (or leave blank)
   - **Value/IP:** Get from Azure Portal → App Service `doclittle` → Properties → Outbound IP addresses (use first IP)
   - **TTL:** 3600 (or default)
4. Click **Save**
5. Wait 5-30 minutes for DNS propagation

**Verify DNS:**
```bash
dig api.callsomo.com
# Should show Azure App Service IP
```

### Step 1d: Create SSL Certificate (After DNS Propagates)

```bash
# Create managed certificate (free)
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname api.callsomo.com

# Get certificate thumbprint
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name api.callsomo.com \
  --query thumbprint \
  --output tsv

# Bind certificate (replace <THUMBPRINT> with output above)
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --hostname api.callsomo.com
```

### Step 2: Verify Environment Variables

```bash
# Check current environment variables
az webapp config appsettings list \
  --resource-group doclittle \
  --name doclittle \
  --output table

# Set new environment variable if needed
az webapp config appsettings set \
  --resource-group doclittle \
  --name doclittle \
  --settings DEFAULT_TENANT_SUBDOMAIN=akin-dunbar
```

### Step 3: Monitor Deployment

```bash
# Watch logs in real-time
az webapp log tail --name doclittle --resource-group doclittle

# Check deployment status
az webapp show --name doclittle --resource-group doclittle --query state
```

### Step 4: Test Deployment

```bash
# Health check
curl https://api.callsomo.com/health

# API check
curl https://api.api.callsomo.com/health

# Test tenant resolution (should work without hardcoded fallbacks)
curl https://api.api.callsomo.com/api/voice/products/search \
  -H "Host: akin-dunbar.api.callsomo.com" \
  -d '{"merchant_id": "your_merchant_id"}'
```

---

## 🚂 Railway Deployment (Alternative)

### Step 1: Connect Repository

1. Go to [Railway Dashboard](https://railway.app)
2. Create new project
3. Connect GitHub repository
4. Select `middleware-platform` as root directory

### Step 2: Configure Environment Variables

In Railway Dashboard → Variables:

```bash
NODE_ENV=production
PORT=4000
API_BASE_URL=https://your-app.railway.app
BASE_URL=https://your-app.railway.app
DEFAULT_TENANT_SUBDOMAIN=akin-dunbar  # Optional
```

### Step 3: Deploy

Railway auto-deploys on git push:

```bash
git add .
git commit -m "Deploy: Fix multi-tenant architecture"
git push origin main
```

### Step 4: Monitor

- View logs in Railway Dashboard
- Check deployment status
- Test endpoints

---

## 🔍 Post-Deployment Verification

### 1. Check Health Endpoints

```bash
# Main health check
curl https://api.callsomo.com/health

# API health check
curl https://api.api.callsomo.com/health

# Should return: {"status":"ok"}
```

### 2. Test Tenant Resolution

```bash
# Test with subdomain (should resolve tenant)
curl https://akin-dunbar.api.callsomo.com/api/voice/products/search \
  -d '{"merchant_id": "test"}'

# Should NOT fallback to hardcoded tenant
# Should return error if merchant not found (not guess)
```

### 3. Test Voice Calls

1. Make a test call to your phone number
2. Check logs for `clinic_id` (not `customer_id`)
3. Verify tenant is resolved correctly

### 4. Check Logs

```bash
# Azure
az webapp log tail --name doclittle --resource-group doclittle

# Look for:
# ✅ "Tenant resolved: subdomain → clinic-xxx"
# ✅ "Using clinic_id: clinic-xxx"
# ❌ Should NOT see: "Using fallback tenant"
```

---

## 🐛 Troubleshooting

### Issue: "Tenant not found" errors

**Cause**: Tenant context middleware can't resolve tenant

**Fix**:
1. Check environment variables are set
2. Verify subdomain routing works
3. Check phone number mapping in database
4. Review logs for tenant resolution method

### Issue: Hardcoded tenant still being used

**Cause**: Old code still running (deployment didn't update)

**Fix**:
1. Verify deployment completed
2. Check file timestamps in Azure/Railway
3. Restart application
4. Clear any caches

### Issue: Voice calls not working

**Cause**: Retell WebSocket handler changes

**Fix**:
1. Check logs for `clinic_id` extraction
2. Verify phone number → clinic mapping
3. Test with explicit `clinic_id` in dynamic variables

### Issue: Database errors

**Cause**: Schema changes (unlikely - no DB changes made)

**Fix**:
1. Check database connection
2. Verify migrations ran
3. Review database logs

---

## 📊 Monitoring Checklist

After deployment, monitor for:

- [ ] No "Tenant not found" errors (unless expected)
- [ ] Logs show `clinic_id` (not `customer_id`)
- [ ] Tenant resolution working (check logs)
- [ ] Voice calls routing correctly
- [ ] Payment flow working
- [ ] No hardcoded fallback warnings

---

## 🔄 Rollback Plan

If issues occur:

### Azure Rollback

```bash
# Option 1: Redeploy previous version
# Use Azure Portal → Deployment Center → History
# Select previous deployment and redeploy

# Option 2: Revert code and redeploy
git revert HEAD
./scripts/deploy-to-azure.sh
```

### Railway Rollback

```bash
# In Railway Dashboard:
# Deployments → Select previous deployment → Redeploy
```

### Quick Fix: Restore Fallback (Emergency Only)

If critical issue, temporarily restore fallback:

```javascript
// In tenant-context.js, change:
allowFallback: false
// To:
allowFallback: true
```

**⚠️ Only use in emergency - this reduces security**

---

## 📝 Deployment Notes

### What Changed

1. **Constants File**: Centralized configuration
2. **Tenant Middleware**: New middleware for tenant resolution
3. **Removed Hardcoded References**: 5 locations updated
4. **Retell WebSocket**: Uses `clinic_id` consistently
5. **Error Handling**: Returns errors instead of guessing

### What Didn't Change

- ✅ No database schema changes
- ✅ No breaking API changes
- ✅ Backward compatible
- ✅ No environment variable requirements (optional)

### Testing Recommendations

1. **Test in Local First** (staging)
   - Verify tenant resolution
   - Test voice calls
   - Check logs

2. **Deploy to Production**
   - Monitor logs closely
   - Test critical flows
   - Watch for errors

3. **Gradual Rollout**
   - Deploy during low-traffic period
   - Monitor for 1-2 hours
   - Have rollback plan ready

---

## 🔗 Related Documentation

- **Architecture Fixes**: `docs/archive/README.md#fixes-applied` (archived)
- **Architecture Issues**: `docs/architecture/README.md#maintenance-architecture-issues`
- **Database Migration**: `docs/deployment/README.md#database-postgres-migration`
- **Security Setup**: `docs/deployment/security/`

---

## ✅ Deployment Checklist

Before deploying:

- [ ] All code changes committed
- [ ] Local testing passed
- [ ] Environment variables verified
- [ ] Database backup created (if needed)
- [ ] Rollback plan ready
- [ ] Monitoring setup ready

After deploying:

- [ ] Health checks passing
- [ ] Tenant resolution working
- [ ] Voice calls working
- [ ] Payment flow working
- [ ] Logs show correct tenant IDs
- [ ] No errors in logs

---

**Status**: ✅ Ready for Deployment  
**Last Updated**: January 27, 2025



---

<a id="readme"></a>

## Deployment Documentation

*Former path: `docs/deployment/README.md`*

Deployment guides, infrastructure setup, and operational documentation.

---

## 📚 Documentation index (verified paths)

| Topic | File |
|--------|------|
| **Main deployment guide** | [`guides/DEPLOYMENT_GUIDE.md`](./README.md#guides-deployment-guide) |
| **Quick Azure deploy** | [`guides/basic/QUICK_DEPLOYMENT_GUIDE.md`](./README.md#guides-basic-quick-deployment-guide) |
| **CI / deploy source of truth** | [`CI_AND_DEPLOY_SOURCE_OF_TRUTH.md`](./README.md#ci-and-deploy-source-of-truth) |
| **Azure email (ACS)** | [`../azure/README.md#readme`](../azure/README.md#readme) |
| **Tenant / DNS automation** | [`azure/AUTOMATED_TENANT_DOMAIN_SETUP.md`](./README.md#azure-automated-tenant-domain-setup) |
| **Postgres migration** | [`database/POSTGRES_MIGRATION.md`](./README.md#database-postgres-migration) |
| **Backups** | [`guides/BACKUP_STRATEGY.md`](./README.md#guides-backup-strategy) |
| **Security** | [`security/SECURITY_IMPROVEMENTS.md`](./README.md#security-security-improvements) |
| **Production API keys** | [`security/PRODUCTION_DEPLOYMENT_API_KEYS.md`](./README.md#security-production-deployment-api-keys) |
| **DNS / SSL** | [`dns/ionos/IONOS_DNS_SETUP.md`](./README.md#dns-ionos-ionos-dns-setup), [`dns/ssl/DOCLITTLE_SITE_SSL_SETUP.md`](./README.md#dns-ssl-doclittle-site-ssl-setup) |

---

## 🚀 Deployment overview

- **Azure** cloud services (see [`../azure/README.md#readme`](../azure/README.md#readme) for email + env)
- **Custom domain / DNS** (`deployment/dns/`, `deployment/azure/`)
- **Database** SQLite default; optional Postgres ([`database/POSTGRES_MIGRATION.md`](./README.md#database-postgres-migration))
- **Security** hardening ([`security/`](./security/))

---

## 🔗 Related documentation

- **Azure:** [`../azure/README.md#readme`](../azure/README.md#readme)
- **Architecture:** [`../architecture/README.md#readme`](../architecture/README.md#readme)
- **Main docs:** [`../README.md#readme`](../README.md#readme)

---

**Last Updated:** April 9, 2026



---

<a id="security-doclittle-site-setup"></a>

## Somo.Site Setup Guide - SaaS Frontend on Azure

*Former path: `docs/deployment/security/DOCLITTLE_SITE_SETUP.md`*

## ✅ Architecture Confirmation

**YES - Confirmed Architecture:**

1. **`api.callsomo.com`** - Main SaaS Site (Root Domain)
   - Frontend: Unified Dashboard (`/unified-dashboard/`)
   - Canonical landing page: `/`
   - Legacy `/landing.html` redirects to `/`
   - Admin portal: `/admin` (from unified-dashboard/admin)
   - Customer signup: `/signup` (from middleware-platform/public/signup)
   - Main SaaS frontend and backend

2. **`api.api.callsomo.com`** - API Subdomain (Already Deployed)
   - API endpoints: All `/api/*` routes
   - Documentation: `/docs` (protected)
   - Webhooks: `/webhook/*`
   - Currently deployed to Azure App Service: `doclittle`

---

## 🎯 Deployment Strategy

### Option 1: Single App Service (Recommended)
**Use the same Azure App Service for both domains:**
- Root domain `api.callsomo.com` → Serves frontend (unified-dashboard)
- API subdomain `api.api.callsomo.com` → Serves API endpoints

**Advantages:**
- Single App Service = Lower cost
- Shared database and resources
- Easier deployment and management
- Unified logging and monitoring

### Option 2: Separate App Services
**Create separate App Services:**
- App Service 1: `doclittle-site` → Frontend only
- App Service 2: `doclittle` (existing) → API only

**Advantages:**
- Separation of concerns
- Independent scaling
- Different runtime stacks if needed

**Disadvantages:**
- Higher cost (2 App Services)
- More complex deployment
- Separate databases needed

---

## 🚀 Implementation: Option 1 (Single App Service)

### Step 1: Update server.js to Serve Frontend

Add route to serve unified-dashboard from root domain:

```javascript
// In middleware-platform/server.js

// Serve frontend from root domain (api.callsomo.com)
app.get('/', (req, res) => {
  // Check if request is for root domain or API subdomain
  const host = req.headers.host;
  
  if (host === 'api.callsomo.com' || host === 'www.api.callsomo.com') {
    // Serve unified dashboard frontend
    res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
  } else if (host === 'api.api.callsomo.com') {
    // API subdomain - serve signup page (or API info)
    res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
  } else {
    // Default to landing page
    res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
  }
});

// Serve unified-dashboard static files
app.use('/assets', express.static(path.join(__dirname, '..', 'unified-dashboard', 'assets')));
app.use('/business', express.static(path.join(__dirname, '..', 'unified-dashboard', 'business')));
app.use('/patients', express.static(path.join(__dirname, '..', 'unified-dashboard', 'patients')));
app.use('/insurer', express.static(path.join(__dirname, '..', 'unified-dashboard', 'insurer')));
app.use('/admin', express.static(path.join(__dirname, '..', 'unified-dashboard', 'admin')));

// Serve unified-dashboard HTML pages
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'login.html'));
});

// Admin portal route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'admin', 'index.html'));
});
```

### Step 2: Configure DNS in IONOS

Add DNS records for root domain `api.callsomo.com`:

**CNAME Record:**
- **Type:** CNAME
- **Name/Host:** `@` (or leave blank for root domain)
- **Value/Points to:** `doclittle.azurewebsites.net`
- **TTL:** 3600

**Note:** Some DNS providers don't allow CNAME on root domain. If IONOS doesn't support CNAME on root:
- Use **A Record** pointing to Azure App Service IP
- Or use **ALIAS Record** if supported
- Or use Azure **App Service Domain** for easier setup

**Alternative: Use Azure App Service Domain (Easier)**
1. Go to Azure Portal → App Service → Custom domains
2. Click **"Buy App Service Domain"**
3. Search for `api.callsomo.com` (if available)
4. Azure will automatically configure DNS

### Step 3: Add Root Domain in Azure App Service

```bash
# Add custom domain
az webapp config hostname add \
  --resource-group doclittle \
  --webapp-name doclittle \
  --hostname api.callsomo.com

# Verify DNS (Azure will check if domain resolves)
az webapp config hostname list \
  --resource-group doclittle \
  --webapp-name doclittle
```

**Or via Azure Portal:**
1. Go to Azure Portal → App Service `doclittle`
2. Click **Custom domains** → **+ Add custom domain**
3. Enter: `api.callsomo.com`
4. Azure will verify DNS automatically

### Step 4: Create SSL Certificate for Root Domain

```bash
# Create managed certificate for root domain
az webapp config ssl create \
  --resource-group doclittle \
  --name doclittle \
  --hostname api.callsomo.com

# Get certificate thumbprint
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name api.callsomo.com \
  --query thumbprint

# Bind certificate to domain
az webapp config ssl bind \
  --resource-group doclittle \
  --name doclittle \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --hostname api.callsomo.com
```

### Step 5: Update Environment Variables

Add to Azure App Service Configuration:

```bash
# Frontend configuration
FRONTEND_BASE_URL=https://api.callsomo.com
API_BASE_URL=https://api.api.callsomo.com

# Enable frontend serving
SERVE_FRONTEND=true
```

---

## 🎨 Frontend Configuration

### Update API Base URL in Frontend

Edit `unified-dashboard/assets/js/config.js`:

```javascript
// Production configuration
const API_BASE_URL = 'https://api.api.callsomo.com';
const FRONTEND_BASE_URL = 'https://api.callsomo.com';

// Development configuration (for local testing)
// const API_BASE_URL = 'http://localhost:4000';
// const FRONTEND_BASE_URL = 'http://localhost:8000';
```

---

## 📋 DNS Configuration Summary

### IONOS DNS Records for `api.callsomo.com`:

**Root Domain (`api.callsomo.com`):**
- **A Record** or **ALIAS** → Azure App Service IP or `doclittle.azurewebsites.net`
- **OR** Use Azure App Service Domain (recommended)

**API Subdomain (`api.api.callsomo.com`):** ✅ Already configured
- **CNAME:** `api` → `doclittle.azurewebsites.net`

**TXT Records:**
- `asuid` → Azure App Service verification (if using Azure domain)
- SPF, DKIM records for email (if needed)

---

## 🔧 Server.js Route Structure

```javascript
// Middleware-platform/server.js structure:

// Root domain (api.callsomo.com) - Frontend
app.get('/', (req, res) => {
  const host = req.headers.host;
  if (host === 'api.callsomo.com' || host === 'www.api.callsomo.com') {
    return res.sendFile(path.join(__dirname, '..', 'unified-dashboard', 'landing.html'));
  }
  // API subdomain handled by signup routes
});

// Unified Dashboard routes
app.use('/assets', express.static(path.join(__dirname, '..', 'unified-dashboard', 'assets')));
app.use('/business', express.static(path.join(__dirname, '..', 'unified-dashboard', 'business')));
app.use('/patients', express.static(path.join(__dirname, '..', 'unified-dashboard', 'patients')));
app.use('/admin', express.static(path.join(__dirname, '..', 'unified-dashboard', 'admin')));

// API subdomain (api.api.callsomo.com) - API endpoints
// Routes defined in routes/signup.js handle signup
// API routes handle all /api/* endpoints
```

---

## 📊 URL Structure

| Domain | Path | Purpose |
|--------|------|---------|
| `api.callsomo.com` | `/` | Landing page |
| `api.callsomo.com` | `/login` | Login page |
| `api.callsomo.com` | `/admin` | Admin portal |
| `api.callsomo.com` | `/business/*` | Business dashboard |
| `api.callsomo.com` | `/patients/*` | Patient portal |
| `api.api.callsomo.com` | `/` | Signup page |
| `api.api.callsomo.com` | `/docs` | API documentation (protected) |
| `api.api.callsomo.com` | `/api/*` | API endpoints |
| `api.api.callsomo.com` | `/webhook/*` | Webhooks |

---

## 🚀 Deployment Checklist

### Before Deploying:

- [ ] Update `server.js` to serve unified-dashboard
- [ ] Update `unified-dashboard/assets/js/config.js` with production API URL
- [ ] Test routes locally
- [ ] Deploy code to Azure

### Azure Configuration:

- [ ] Add `api.callsomo.com` as custom domain in Azure
- [ ] Configure DNS in IONOS (A record or ALIAS)
- [ ] Create SSL certificate for `api.callsomo.com`
- [ ] Bind SSL certificate to domain
- [ ] Verify DNS propagation

### Testing:

- [ ] Visit `https://api.callsomo.com` → Should show landing page
- [ ] Visit `https://api.callsomo.com/admin` → Should show admin portal
- [ ] Visit `https://api.api.callsomo.com` → Should show signup page
- [ ] Visit `https://api.api.callsomo.com/docs` → Should show API docs (if authenticated)
- [ ] Test API calls: `curl https://api.api.callsomo.com/health`

---

## 🔍 Troubleshooting

### DNS Not Resolving
```bash
# Check DNS propagation
dig api.callsomo.com
nslookup api.callsomo.com

# Should point to Azure App Service IP
```

### SSL Certificate Issues
```bash
# List SSL certificates
az webapp config ssl list \
  --resource-group doclittle \
  --name doclittle

# Check certificate binding
az webapp config ssl show \
  --resource-group doclittle \
  --certificate-name api.callsomo.com
```

### Frontend Not Loading
- Check that routes are configured correctly in `server.js`
- Verify static file paths
- Check browser console for errors
- Verify `API_BASE_URL` in frontend config

---

## 💰 Cost Estimation

### Single App Service (Current Setup):
- **Basic B1 SKU:** ~$13/month
- **Free SSL:** Included (managed certificates)
- **Custom domains:** First 5 domains free
- **Total:** ~$13/month

### If Using Separate App Services:
- **App Service 1 (Frontend):** ~$13/month
- **App Service 2 (API):** ~$13/month
- **Total:** ~$26/month

---

## 📝 Next Steps

1. **Update server.js** to serve unified-dashboard
2. **Configure DNS** in IONOS for root domain
3. **Add custom domain** in Azure
4. **Create SSL certificate** for `api.callsomo.com`
5. **Deploy code** and test
6. **Update frontend config** with production URLs

---

**Status:** 📋 Planning  
**Last Updated:** January 2025



---

<a id="security-production-deployment-api-keys"></a>

## Production Deployment - Per-Client API Keys & Admin Portal

*Former path: `docs/deployment/security/PRODUCTION_DEPLOYMENT_API_KEYS.md`*

## 🚀 Quick Deployment to api.api.callsomo.com

### Step 1: Set ADMIN_PORTAL_SECRET in Azure

**Generate a secure secret:**
```bash
openssl rand -hex 32
```

**Set in Azure Portal:**
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **Resource Groups** → **doclittle** → **doclittle**
3. Click **Configuration** → **Application settings**
4. Click **+ New application setting**
5. Name: `ADMIN_PORTAL_SECRET`
6. Value: `[paste the generated secret]`
7. Click **OK** → **Save**

**Or via Azure CLI:**
```bash
# Generate secret (save this value!)
ADMIN_SECRET=$(openssl rand -hex 32)
echo "Generated ADMIN_PORTAL_SECRET: $ADMIN_SECRET"

# Set in Azure
az webapp config appsettings set \
  --resource-group doclittle \
  --name doclittle \
  --settings ADMIN_PORTAL_SECRET="$ADMIN_SECRET"
```

### Step 2: Deploy Code

**Quick deploy script:**
```bash
cd /path/to/somo
chmod +x scripts/deploy-to-azure.sh
./scripts/deploy-to-azure.sh
```

**Manual deploy:**
```bash
cd middleware-platform
zip -r ../deploy.zip . -x "*.git*" -x "node_modules/*" -x "*.env*" -x "*test*" -x "*.md" -x "package-lock.json"

az webapp deployment source config-zip \
  --resource-group doclittle \
  --name doclittle \
  --src ../deploy.zip

rm ../deploy.zip
```

### Step 3: Verify Deployment

**Check app status:**
```bash
az webapp show --name doclittle --resource-group doclittle --query state
```

**View logs:**
```bash
az webapp log tail --name doclittle --resource-group doclittle
```

**Test health endpoint:**
```bash
curl https://api.api.callsomo.com/health
# Should return: {"status":"ok"}
```

### Step 4: Test Admin Portal

1. **Open admin portal:**
   - URL: `https://api.api.callsomo.com/admin/portal`
   - You should see the login screen (if `ADMIN_PORTAL_SECRET` is set)

2. **Login:**
   - Enter the `ADMIN_PORTAL_SECRET` you set in Step 1
   - Click "Login"

3. **Verify features:**
   - ✅ Dashboard loads with metrics
   - ✅ Clients section shows client list
   - ✅ "Edit Client" button opens modal
   - ✅ "API Keys" section shows per-client keys
   - ✅ "Generate Key" button works
   - ✅ "Copy Key" shows one-time secret
   - ✅ "Rotate Key" updates client credentials

### Step 5: Test API Key Endpoints

**1. Create a test client:**
```bash
curl -X POST https://api.api.callsomo.com/api/admin/clients \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=YOUR_SESSION_COOKIE" \
  -d '{
    "name": "Test Client",
    "phone_number": "+15551234567",
    "email": "test@example.com"
  }'
```

**2. Generate API key for client:**
```bash
curl -X POST https://api.api.callsomo.com/api/admin/clients/{CLINIC_ID}/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=YOUR_SESSION_COOKIE" \
  -d '{
    "name": "Production Key",
    "revoke_existing": false
  }'
```

**3. Test API key authentication:**
```bash
curl https://api.api.callsomo.com/api/admin/clients \
  -H "X-API-Key: sk_xxxxxxxxxxxxxxxx"
```

## 🔒 Security Checklist

- ✅ `ADMIN_PORTAL_SECRET` is set in Azure (64-character hex string)
- ✅ Admin portal requires authentication
- ✅ API keys are hashed before storage (SHA-256)
- ✅ API keys are only shown once on generation
- ✅ All `/api/admin/*` endpoints are protected
- ✅ Session cookies are secure (HttpOnly, Secure, SameSite)
- ✅ Database migrations ran successfully

## 📋 New Features Deployed

### Admin Portal
- **Per-Client API Key Management**
  - Generate unique API keys per client
  - Rotate keys (with option to revoke existing)
  - View key history (without revealing secrets)
  - Copy one-time key on generation

- **Enhanced Client Management**
  - Edit client configurations
  - View API key status per client
  - Link clients to Retell agents (client 1 → voice agent 1)

### API Endpoints
- `POST /api/admin/clients/:clinicId/api-keys` - Generate API key
- `PUT /api/admin/clients/:clinicId/api-keys/:keyId/rotate` - Rotate key
- `DELETE /api/admin/clients/:clinicId/api-keys/:keyId` - Revoke key
- `GET /api/admin/clients/:clinicId/api-keys` - List keys (masked)
- `POST /api/admin/auth/login` - Admin login
- `POST /api/admin/auth/logout` - Admin logout
- `GET /api/admin/auth/status` - Check session

### Database Schema
- `merchant_api_keys` table created
- Migrations run automatically on startup
- API keys hashed with SHA-256
- Usage tracking enabled

## 🐛 Troubleshooting

### Admin Portal Shows "Unauthorized"
- Check `ADMIN_PORTAL_SECRET` is set in Azure
- Verify you're using the correct secret when logging in
- Check browser console for errors

### API Keys Not Working
- Verify client exists: `GET /api/admin/clients`
- Check key is active: `GET /api/admin/clients/:id/api-keys`
- Verify key format: `sk_` prefix + 64 hex characters
- Check request headers: `X-API-Key` or `Authorization: Bearer`

### Database Migration Errors
- Check logs: `az webapp log tail --name doclittle --resource-group doclittle`
- Verify SQLite database is writable
- Database path: `/home/middleware.db` (Azure)

## 📊 Post-Deployment Monitoring

**Monitor logs for:**
- Database migration success
- Admin portal login attempts
- API key generation/rotation events
- Authentication failures

**Check these endpoints:**
```bash
# Health check
curl https://api.api.callsomo.com/health

# Admin portal
curl -I https://api.api.callsomo.com/admin/portal

# API docs
curl -I https://api.api.callsomo.com/docs
```

---

**Last Updated:** 2025-01-XX  
**Status:** ✅ Ready for Production Deployment



---

<a id="security-security-improvements"></a>

## Security & Production Improvements

*Former path: `docs/deployment/security/SECURITY_IMPROVEMENTS.md`*

## What Was Implemented

### 1. Rate Limiting ✅
- **General API**: 100 requests per 15 minutes per IP
- **Authentication endpoints**: 5 attempts per 15 minutes per IP
- **Payment endpoints**: 10 requests per hour per IP
- **Voice endpoints**: 20 requests per minute per IP

**Files**: `middleware/rate-limiter.js`

### 2. Security Headers ✅
- Helmet.js integration for security headers
- Content Security Policy (CSP)
- XSS protection
- Clickjacking protection

**Files**: `middleware/security.js`

### 3. Input Sanitization ✅
- Automatic sanitization of all request data
- Removes dangerous characters
- Trims whitespace
- Recursive object sanitization

**Files**: `middleware/security.js`

### 4. Request Logging ✅
- Structured request logging
- Tracks method, path, status code, duration
- IP address and user agent logging

**Files**: `middleware/security.js`, `services/logger.js`

### 5. Circle Webhook Signature Verification ✅
- HMAC SHA256 signature verification
- Timing-safe comparison to prevent timing attacks
- Production-ready implementation

**Files**: `services/circle-service.js`

### 6. Authentication Middleware ✅
- API key authentication support
- Optional API key for flexible endpoints
- Merchant verification

**Files**: `middleware/auth.js`

### 7. Admin Portal Protection ✅
- `/admin/portal` and all `/api/admin/*` routes are gated by short-lived admin sessions
- `ADMIN_PORTAL_SECRET` issues HTTP-only cookies via `/api/admin/session`
- Static portal now renders a login overlay when the session expires

**Files**: `middleware/admin-auth.js`, `server.js`, `public/admin/*`

### 8. Per-Client API Keys ✅
- New `merchant_api_keys` table stores hashed keys + audit metadata
- Admin portal can mint, rotate, and revoke keys per clinic
- Verification middleware matches SHA-256 hashes to prevent key leakage

**Files**: `database.js`, `middleware/auth.js`, `server.js`, `public/admin/*`

## Installation

```bash
cd middleware-platform
npm install express-rate-limit helmet
```

## Configuration

No additional configuration needed - works out of the box!

Optional environment variables:
```bash
LOG_LEVEL=info  # error, warn, info, debug
CIRCLE_WEBHOOK_SECRET=your_webhook_secret  # For Circle webhook verification
ADMIN_PORTAL_SECRET=super_secure_passphrase  # Enables admin login
```

## What's Protected

### Rate Limited Endpoints:
- ✅ `/api/*` - General API (100/15min)
- ✅ `/api/auth/*` - Authentication (5/15min)
- ✅ `/api/patient/verify/*` - Patient verification (5/15min)
- ✅ `/voice/*` - Voice endpoints (20/min)
- ✅ `/process-payment` - Payment processing (10/hour)

### Security Headers Applied:
- ✅ All endpoints protected with security headers
- ✅ CSP configured for Stripe and external resources
- ✅ XSS and clickjacking protection

### Input Sanitization:
- ✅ All request bodies sanitized
- ✅ All query parameters sanitized
- ✅ All URL parameters sanitized

## Testing

The middleware is automatically applied. Test by:
1. Making rapid requests to see rate limiting
2. Checking response headers for security headers
3. Sending malicious input to see sanitization

## Next Steps (Optional)

1. **Error Tracking**: Integrate Sentry or similar
2. **API Keys**: Enable API key auth on protected endpoints
3. **Monitoring**: Set up alerts for rate limit violations
4. **Logging**: Send logs to external service (CloudWatch, etc.)



