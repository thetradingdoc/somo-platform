# Email Debugging Guide

## 🔍 How to Debug Email Issues

### Step 1: Check Email Service Status

```bash
curl http://localhost:4000/api/test/email/status
```

This will show:
- Whether SMTP or Azure is configured
- What email provider is being used
- Configuration status

### Step 2: Test Simple Email Send

```bash
curl -X POST http://localhost:4000/api/test/email/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "doctorjay254@gmail.com",
    "subject": "Test Email",
    "html": "<p>Test</p>"
  }'
```

### Step 3: Test All Email Types

```bash
curl -X POST http://localhost:4000/api/test/email/all \
  -H "Content-Type: application/json" \
  -d '{
    "patient_email": "doctorjay254@gmail.com",
    "insurer_email": "gigtogigdev@gmail.com"
  }'
```

### Step 4: Check Server Logs

The email service logs detailed information:
- If in simulation mode: Emails are logged to console
- If SMTP configured: Shows SMTP connection details
- If Azure configured: Shows Azure send results

### Step 5: Use Debug Script

```bash
node tests/test-email-debug.js
```

This comprehensive script:
1. Checks email service status
2. Tests simple email send
3. Tests all email types
4. Shows detailed diagnostics

---

## 📧 Email Configuration

### Option 1: SMTP (Gmail, SendGrid, etc.)

Add to `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=your-email@gmail.com
```

### Option 2: Azure Communication Services

Add to `.env`:
```
AZURE_COMMUNICATION_CONNECTION_STRING=endpoint=...
AZURE_EMAIL_SENDER=DoNotReply@your-domain.com
```

---

## 🐛 Common Issues

### Issue: "Email service is in simulation mode"
**Solution:** Configure SMTP or Azure (see above)

### Issue: "SMTP connection failed"
**Solution:** 
- Check SMTP credentials
- For Gmail: Use App Password, not regular password
- Check firewall/network restrictions

### Issue: "Azure email failed"
**Solution:**
- Verify connection string
- Check sender address is verified in Azure
- Check Azure service status

---

## 📊 Email Test Endpoints

All endpoints are under `/api/test/email/`:

- `GET /api/test/email/status` - Check configuration
- `POST /api/test/email/send` - Send test email
- `POST /api/test/email/appointment` - Test appointment email
- `POST /api/test/email/insurance-billing` - Test insurance billing
- `POST /api/test/email/patient-billing` - Test patient billing
- `POST /api/test/email/checkout` - Test checkout email
- `POST /api/test/email/all` - Test all email types

---

## 🔍 Debugging Workflow

1. **Check Status**: `GET /api/test/email/status`
2. **Test Simple Send**: `POST /api/test/email/send`
3. **Check Server Logs**: Look for email send attempts
4. **Verify Configuration**: Check `.env` file
5. **Test Individual Types**: Use specific test endpoints
6. **Check Inboxes**: If configured, verify emails arrive

---

## 📝 Email Flow

1. **Appointment Booking** → Sends confirmation email
2. **Insurance Claim** → Sends billing email to insurer
3. **Patient Checkout** → Sends verification code + billing email
4. **Appointment Reminder** → Sent 24h before (if scheduled)

---

## ✅ Verification Checklist

- [ ] Email service status shows configured provider
- [ ] Test email send returns success
- [ ] Server logs show email send attempts
- [ ] Emails appear in inbox (if real provider configured)
- [ ] All 4 email types tested successfully

