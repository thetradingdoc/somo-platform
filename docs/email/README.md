# email — consolidated documentation

**Single file:** All former `docs/email/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Email Issues Verification - All 3 Problems Fixed ✅ (`email-issues-verification.md`)](#email-issues-verification)
- [Local Email Setup Guide (`LOCAL_EMAIL_SETUP.md`)](#local-email-setup)
- [Email Service Documentation (`README.md`)](#readme)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="email-issues-verification"></a>

## Email Issues Verification - All 3 Problems Fixed ✅

*Former path: `docs/email/email-issues-verification.md`*

## Problem 1: Email Request Repetition ✅ FIXED

### Issue
Agent was asking for email multiple times during checkout flow.

### Root Cause
- Prompt had redundant email confirmation steps
- Agent was asking for email again if `create_checkout` failed

### Fixes Applied

1. **Prompt Updated** (`docs/voice-agent/shop-voice-agent-prompt.md`):
   - Line 181: "Do NOT ask for email again (you already have it)"
   - Line 182: Clear instruction to report error without re-asking
   - Removed redundant email confirmation steps

2. **Connection State** (`middleware-platform/webhooks/retell-websocket.js`):
   - Lines 606-619: Email is stored in `connection.customerEmail`
   - Lines 610-613: Fallback to connection state if not in function args
   - Email persists across function calls

### Verification
- ✅ Prompt explicitly says "Do NOT ask for email again"
- ✅ Email stored in connection state
- ✅ Fallback to connection state if missing from function args

---

## Problem 2: Contradictory Tool Call Response ✅ FIXED

### Issue
Tool call `4a8f6acf8aa6ff2b` returned:
```json
{
  "success": false,
  "error": "Email address is required to send payment link",
  "message": "Payment link sent via email"  // ❌ Contradictory!
}
```

### Root Cause
`voice-adapter.js` was always setting default message `"Payment link sent via email"` even when `success: false`.

### Fix Applied

**File**: `middleware-platform/adapters/voice-adapter.js`
**Lines**: 120-138

```javascript
static fromStandardResponse(standardResponse) {
    // Only set default message if successful and no error
    const defaultMessage = standardResponse.success && !standardResponse.error 
        ? 'Payment link sent via email' 
        : null;
    
    return {
        success: standardResponse.success,
        // ...
        message: standardResponse.message || defaultMessage,  // ✅ Only uses default if success=true
        error: standardResponse.error || null,
        // ...
    };
}
```

### Verification
- ✅ Default message only set when `success: true`
- ✅ Error message takes precedence when `success: false`
- ✅ No contradictory messages

---

## Problem 3: Email Missing in Tool Calls ✅ FIXED

### Issue
`create_checkout` tool calls were failing because email was missing from function arguments.

### Root Causes
1. Email not being passed in function call
2. Email lost during adapter conversion
3. Email not stored in connection state

### Fixes Applied

1. **Email Extraction & Storage** (`middleware-platform/webhooks/retell-websocket.js`):
   - Lines 606-619: Extracts email from function args OR connection state
   - Stores email in connection for future use
   - Logs email at multiple stages for debugging

2. **Early Validation** (`middleware-platform/routes/voice.js`):
   - Lines 304-319: Validates email BEFORE adapter conversion
   - Lines 345-357: Validates email AFTER adapter conversion
   - Prevents email loss during processing

3. **Error Handling** (`middleware-platform/webhooks/retell-websocket.js`):
   - Lines 634-640: Returns clear error with `requires_email: true`
   - Agent can detect this and ask for email (only once)

### Verification
- ✅ Email extracted from multiple sources
- ✅ Email stored in connection state
- ✅ Email validated before and after adapter conversion
- ✅ Clear error messages when email missing

---

## Error Flow Analysis

### Current Flow (After Fixes)

1. **Agent calls `create_checkout`**:
   - Email should be in `functionArgs.customer_email`
   - If not, checks `connection.customerEmail` (fallback)

2. **`handleCreateCheckout` processes**:
   - Extracts email from args or connection
   - Stores in connection for future use
   - Validates email exists
   - If missing: Returns error with `requires_email: true`

3. **Backend `/voice/checkout/create`**:
   - Validates email in request body
   - Validates email after adapter conversion
   - Returns clear error if email missing

4. **Response formatting** (`voice-adapter.js`):
   - If `success: false`: Uses error message, NOT default
   - If `success: true`: Uses success message

### Error Message Sources

1. **"Email address is required to send payment link"**:
   - Source: `payment-orchestrator.js:219`
   - Occurs when: Checkout created but email missing when sending payment link
   - Status: ✅ This is a valid error (shouldn't happen if email validation works)

2. **"customer_email is required. Please provide your email address."**:
   - Source: `retell-websocket.js:637`
   - Occurs when: Email missing in function call
   - Status: ✅ Clear error with `requires_email: true`

3. **"Email address is required to create checkout"**:
   - Source: `routes/voice.js:315, 353`
   - Occurs when: Email missing in request
   - Status: ✅ Clear error with `requires_email: true`

---

## Remaining Edge Case

### Issue
If checkout is created successfully but email is lost before `_handleLinkPayment`:
- Checkout record exists
- Payment link cannot be sent
- Error: "Email address is required to send payment link"

### Prevention
- ✅ Email validated before checkout creation
- ✅ Email validated after adapter conversion
- ✅ Email stored in checkout record
- ✅ Email passed to `_handleLinkPayment`

### If This Still Occurs
This would indicate:
1. Database issue (email not saved in checkout)
2. Race condition (email cleared between steps)
3. Data corruption

**Action**: Check checkout record in database to verify email was saved.

---

## ✅ All 3 Problems SOLVED

1. ✅ **Email Request Repetition**: Fixed in prompt and connection state
2. ✅ **Contradictory Messages**: Fixed in `voice-adapter.js`
3. ✅ **Email Missing**: Fixed with extraction, storage, and validation

**Status**: ✅ **READY FOR DEPLOYMENT**



---

<a id="local-email-setup"></a>

## Local Email Setup Guide

*Former path: `docs/email/LOCAL_EMAIL_SETUP.md`*

## Quick Setup (Gmail - Recommended)

### Step 1: Get Gmail App Password

1. Go to: https://myaccount.google.com/apppasswords
2. Sign in to your Google account
3. Select "Mail" and "Other (Custom name)"
4. Enter "DocLittle Local Dev"
5. Click "Generate"
6. Copy the 16-character password (you'll need this)

### Step 2: Configure .env File

Add these lines to `middleware-platform/.env`:

```bash
# Email Configuration (Local Development)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password
SMTP_FROM=your-email@gmail.com

# Base URL for payment links
BASE_URL=http://localhost:4000
API_BASE_URL=http://localhost:4000
```

**Replace:**
- `your-email@gmail.com` with your Gmail address
- `your-16-char-app-password` with the App Password from Step 1

### Step 3: Test Email

Run the test script:

```bash
cd middleware-platform
node scripts/test-email-payment-link.js
```

This will:
1. Create a mock checkout
2. Send a payment link email to the configured test address
3. Show you the email content

## Alternative: Use Setup Script

Run the interactive setup:

```bash
cd middleware-platform
node scripts/configure-local-email.js
```

Or use the bash script (if available):

```bash
cd middleware-platform
./scripts/setup-local-email.sh
```

## Other Email Services

### SendGrid

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_FROM=noreply@yourdomain.com
```

### Mailgun

```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=your-mailgun-smtp-username
SMTP_PASSWORD=your-mailgun-smtp-password
SMTP_FROM=noreply@yourdomain.com
```

## Important Notes

1. **Payment Links**: The `BASE_URL` determines what URL is used in payment links
   - Local: `http://localhost:4000/payment/...`
   - Production: Use your deployed API URL

2. **Security**: Never commit your `.env` file to git (it's already in `.gitignore`)

## Troubleshooting

### "Email not sending"
- Check your SMTP credentials are correct
- For Gmail: Make sure you're using an App Password, not your regular password
- Check your firewall isn't blocking port 587

### "Payment link shows localhost"
- This is expected for local testing
- Change `BASE_URL` in `.env` if you want a different URL

### "nodemailer not installed"
```bash
npm install nodemailer
```

---

**Last Updated:** January 2026


---

<a id="readme"></a>

## Email Service Documentation

*Former path: `docs/email/README.md`*

Documentation for email functionality and configuration.

## Current Setup

- **Provider:** Azure Communication Services (production)
- **Domain:** doclittle.site
- **Sender:** DoNotReply@doclittle.site
- **Status:** Production Ready

## Configuration

### Local Development

See [Local Email Setup](./README.md#local-email-setup) for Gmail/SMTP setup.

### Production

- Azure Communication Services
- Connection string in `.env`: `AZURE_COMMUNICATION_CONNECTION_STRING`
- Verify sender address in Azure portal

## Email Types

1. Appointment confirmation
2. Insurance billing
3. Patient billing
4. Checkout verification

## Related Documentation

- [Azure Setup](../azure/README.md#readme)
- [Setup Guide](../setup/README.md#getting-started-setup)
- [Email Issues Verification](./README.md#email-issues-verification)
- [Main Docs](../README.md#readme)

---

**Last Updated:** April 9, 2026


