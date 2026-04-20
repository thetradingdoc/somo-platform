# azure — consolidated documentation

**Single file:** All former `docs/azure/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Daily Medical Receptionist Automation (`AZURE_AUTOMATION.md`)](#azure-automation)
- [Azure Configuration Guide (`README.md`)](#readme)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="azure-automation"></a>

## Daily Medical Receptionist Automation

*Former path: `docs/azure/AZURE_AUTOMATION.md`*

This playbook wires the new `run-medical-receptionist-search.js` helper into an Azure-scheduled job so we always capture fresh medical receptionist postings without blowing through the 250-call monthly limit.

## 1. Prerequisites

- `ADMIN_PORTAL_SECRET` set in the middleware `.env`
- Production `API_BASE_URL` (e.g. `https://doclittle.site`)
- Optional overrides:
  - `MEDICAL_RECEPTIONIST_LOCATION` (defaults to `US,NY`)
  - `MEDICAL_RECEPTIONIST_DAYS` (defaults to `1` → “today”)
  - `ADMIN_PORTAL_BASE_URL` if the admin endpoints live on a different domain
- `INTERNAL_JOB_TOKEN` (optional): when set, include the same value in the job’s `X-Internal-Job-Token` header so the script bypasses the global rate limiter.

## 2. Manual Run (Sanity Check)

```bash
cd middleware-platform
npm run search:medical
```

What happens:
1. Logs into `/api/admin/session` with `ADMIN_PORTAL_SECRET`
2. Hits `/api/admin/leads/insights/medical-receptionist?location=...&days=...`
3. Saves the lead via `/api/admin/leads/save`
4. Attempts contact extraction if the listing lacked phone/email

All output is printed with timestamps so it’s safe to stream into Azure logs.

## 3. Azure Container Apps Job

Create a lightweight job that runs the script once per day:

```bash
# Build image that contains the middleware repo (or mount via volume)
# Example uses the public `Node 22` image plus startup command.

az containerapp job create \
  --name medical-receptionist-daily \
  --resource-group <RG_NAME> \
  --environment <CONTAINER_APPS_ENV> \
  --trigger-type Schedule \
  --cron-expression "50 16 * * *" \  # 11:50 PM NYC (adjust to UTC)
  --replica-timeout 900 \
  --replica-retry-limit 1 \
  --replica-completion-count 1 \
  --parallelism 1 \
  --image mcr.microsoft.com/devcontainers/javascript-node:22 \
  --env-vars \
      ADMIN_PORTAL_SECRET=<secret> \
      ADMIN_PORTAL_BASE_URL=https://doclittle.site \
      MEDICAL_RECEPTIONIST_LOCATION=US,NY \
      MEDICAL_RECEPTIONIST_DAYS=1 \
  --command "bash" \
  --args "-lc" "cd /workspace/middleware-platform && npm install --omit=dev && npm run search:medical"
```

> Tip: Replace `/workspace/middleware-platform` with the actual path inside the image or bake the repo into a custom container so the job only runs the script.

## 4. Monitoring

- The script exits with `0` on success and `1` on failure. Azure Container Apps will flag failures automatically; add alerting on repeated failures.
- Logs show every step (`login`, `insights`, `save`, `extract`) with timestamps using the `[medical-receptionist-daily]` prefix for easy filtering.
- Since we only call the insights endpoint once per day, we remain well inside the 250-call/month ceiling.

## 5. Extending

- To target additional geographies, chain multiple jobs with different `MEDICAL_RECEPTIONIST_LOCATION` values.
- If you’d like an email/slack notification, wrap the script with another process that consumes the JSON log and routes the summary to your notification channel.



---

<a id="readme"></a>

## Azure Configuration Guide

*Former path: `docs/azure/README.md`*

**Domain:** doclittle.site  
**Status:** ✅ Azure Email Configured & Operational

---

## 🎯 CURRENT STATUS

- ✅ Azure Communication Services configured
- ✅ Email Communication Service linked
- ✅ Domain `doclittle.site` verified
- ✅ Sender address `DoNotReply@doclittle.site` verified
- ✅ All 4 email types working via Azure
- ✅ Connection string configured in `.env`

**Status:** ✅ **PRODUCTION READY**

---

## 📋 QUICK REFERENCE

### Azure Resources
- **Communication Services:** `doclittle-communication`
- **Email Communication Service:** `doclittle-email`
- **Resource Group:** `doclittle-rg`
- **Domain:** `doclittle.site` (Verified)
- **Sender:** `DoNotReply@doclittle.site` (Verified)

### Environment Variables (`.env`)
```bash
AZURE_COMMUNICATION_CONNECTION_STRING=endpoint=https://doclittle-rg.unitedstates.communication.azure.com/;accesskey=...
AZURE_EMAIL_SENDER=DoNotReply@doclittle.site
```

### Email Test Results
- ✅ Appointment Confirmation - Sent successfully
- ✅ Insurance Billing - Sent successfully
- ✅ Patient Billing - Sent successfully
- ✅ Checkout Verification - Sent successfully

---

## 🚀 SETUP GUIDE (For New Setup)

### Step 1: Create Azure Resources (15-20 min)

**1.1 Create Communication Services**
1. Go to [Azure Portal](https://portal.azure.com)
2. Search "Communication Services"
3. Click "Create"
4. Fill in:
   - Name: `doclittle-communication`
   - Resource Group: `doclittle-rg` (create new or use existing)
   - Data Location: `United States`
5. Click "Review + create" → "Create"
6. **IMPORTANT:** After creation, go to "Keys" and copy the **Connection string**

**1.2 Create Email Communication Service**
1. Search "Email Communication Services"
2. Click "Create"
3. Fill in:
   - Name: `doclittle-email`
   - Resource Group: Same as above
   - Data Location: Same as above
4. Click "Review + create" → "Create"

**1.3 Link Email Service to Communication Services**
1. Go to Communication Services resource (`doclittle-communication`)
2. Click "Email" in left menu
3. Click "Connect Email Communication Service"
4. Select `doclittle-email`
5. Click "Connect"

### Step 2: Add and Verify Domain (10-15 min)

**2.1 Add Domain**
1. Go to Email Communication Service (`doclittle-email`)
2. Click "Domains" → "Add domain"
3. Enter: `doclittle.site`
4. Click "Add"
5. Azure will show DNS records needed - **COPY THESE VALUES**

**2.2 Add DNS Records to Domain Registrar (IONOS)**
1. Log in to [IONOS](https://www.ionos.com)
2. Go to **Domains** → **doclittle.site** → **DNS Settings**
3. Add these records (Azure provides exact values):

   **MX Record:**
   ```
   Type: MX
   Name: @ (or doclittle.site)
   Value: [Azure provides - e.g., mail.doclittle.communication.azure.com]
   Priority: 10
   TTL: 3600
   ```

   **TXT Record (Domain Verification):**
   ```
   Type: TXT
   Name: @ (or doclittle.site)
   Value: [Azure provides - e.g., "azure-verify=abc123..."]
   TTL: 3600
   ```

   **CNAME Records (SPF/DKIM - usually 2-3 records):**
   ```
   Type: CNAME
   Name: [Azure provides - e.g., selector1._domainkey]
   Value: [Azure provides]
   TTL: 3600
   ```

4. Save all records
5. Wait 10-15 minutes for DNS propagation

**2.3 Verify Domain in Azure**
1. Go to Email Communication Service → "Domains"
2. Click "Verify" next to `doclittle.site`
3. Status should change to "Verified" ✅

### Step 3: Create Sender Address (2 min)

**3.1 Add Sender Address**
1. In Email Communication Service, click "Sender addresses"
2. Click "Add sender address"
3. Enter: `DoNotReply@doclittle.site`
4. Click "Add"

**3.2 Verify Sender Address**
1. Azure will send verification email to `DoNotReply@doclittle.site`
2. Check the email inbox
3. Click the verification link
4. Status should change to "Verified" ✅

### Step 4: Configure Application (1 min)

**4.1 Add to `.env`**
Open `middleware-platform/.env` and add:
```bash
AZURE_COMMUNICATION_CONNECTION_STRING=endpoint=https://doclittle-communication.communication.azure.com/;accesskey=YOUR_ACTUAL_KEY_HERE
AZURE_EMAIL_SENDER=DoNotReply@doclittle.site
```

**4.2 Replace Connection String**
- Replace `YOUR_ACTUAL_KEY_HERE` with the connection string from Step 1.1
- Copy the entire string (starts with `endpoint=https://`)
- No extra spaces or line breaks

### Step 5: Test (1 min)

**5.1 Restart Server**
```bash
cd middleware-platform
npm start
```

**5.2 Test Email**
```bash
node scripts/verify-azure-email.js doctorjay254@gmail.com
```

**5.3 Check Inbox**
- Email should arrive in inbox ✅
- Should see: `Provider: azure` in logs
- Should see Message ID from Azure

---

## 🔍 TROUBLESHOOTING

### Error: "The specified sender domain has not been linked"

**Solution:**
1. Go to Communication Services resource
2. Click "Email" → "Connect Email Communication Service"
3. Select your Email Communication Service
4. Click "Connect"
5. Test again

### DNS Not Verifying

**Check:**
1. Wait 15-30 minutes after adding DNS records
2. Verify DNS records are correct:
   ```bash
   nslookup -type=MX doclittle.site
   nslookup -type=TXT doclittle.site
   ```
3. Ensure values match Azure exactly (no extra spaces)
4. Check IONOS DNS settings show the records

### Connection String Not Working

**Check:**
1. Copied entire string (starts with `endpoint=https://`)
2. No extra spaces or line breaks
3. String is in `.env` file correctly
4. Restarted server after adding to `.env`

### Emails Not Sending

**Check:**
1. Domain is verified in Azure Portal
2. Sender address is verified in Azure Portal
3. Email Service is linked to Communication Services
4. Connection string is correct in `.env`
5. Check server logs for error messages
6. Check Azure Portal → Email delivery for delivery status

---

## 📧 EMAIL TYPES CONFIGURED

1. **Appointment Confirmation** ✅
   - Sent to patients after booking
   - Provider: Azure

2. **Insurance Billing** ✅
   - Sent to insurers for claims
   - Provider: Azure

3. **Patient Billing** ✅
   - Sent to patients for payments
   - Provider: Azure

4. **Checkout Verification** ✅
   - Sent to patients for payment verification
   - Provider: Azure

---

## 💰 COST

- **Free Tier:** First 5,000 emails/month FREE
- **After Free Tier:** ~$0.10 per 1,000 emails
- **Current Usage:** Within free tier

---

## 📊 MONITORING

### Check Email Status in Azure Portal:
1. Go to Email Communication Service
2. Check "Email delivery" for statistics
3. View sent emails and delivery status

### Check Application Logs:
- Look for: `📧 Email sent via Azure: [message-id]`
- All emails should show `Provider: azure`

---

## 🔗 RELATED DOCUMENTATION

- **Deployment:** [Deployment Guide](../deployment/README.md#guides-deployment-guide)
- **Email Service:** `../email/README.md#readme`
- **Main Docs:** `../README.md#readme`

---

**Last Updated:** April 9, 2026  
**Status:** ✅ Production Ready - All Email Types Working


