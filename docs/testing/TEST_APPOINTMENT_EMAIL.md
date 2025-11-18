# Testing Appointment Email Booking

## Overview

This document explains how to test that appointment booking emails are working correctly and being sent to users with appointment details.

## Test Methods

### Method 1: API Test Endpoint (Recommended)

**Endpoint:** `POST /api/test/appointment-email`

**Request Body:**
```json
{
  "patient_name": "Test Patient",
  "patient_phone": "+15551234567",
  "patient_email": "your-email@example.com",
  "appointment_type": "Cardiology Consultation",
  "date": "2025-11-15",
  "time": "2:00 PM",
  "timezone": "America/New_York"
}
```

**cURL Command:**
```bash
curl -X POST http://localhost:4000/api/test/appointment-email \
  -H "Content-Type: application/json" \
  -d '{
    "patient_email": "your-email@example.com",
    "patient_name": "Test Patient",
    "appointment_type": "Cardiology Consultation",
    "date": "2025-11-15",
    "time": "2:00 PM"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Test appointment created successfully",
  "appointment": {
    "id": "appt-...",
    "confirmation_number": "ABC12345",
    "patient_name": "Test Patient",
    "patient_email": "your-email@example.com",
    "date": "2025-11-15",
    "time": "2:00 PM",
    "appointment_type": "Cardiology Consultation",
    "status": "scheduled"
  },
  "emailSent": true,
  "emailProvider": "smtp",
  "emailAddress": "your-email@example.com",
  "instructions": "Check your email inbox at your-email@example.com for the confirmation email."
}
```

### Method 2: Node.js Test Script

**File:** `middleware-platform/tests/test-appointment-email.js`

**Usage:**
```bash
cd middleware-platform
node tests/test-appointment-email.js
```

**Note:** Update the `TEST_APPOINTMENT.patient_email` in the script to your test email address.

### Method 3: API Test Script

**File:** `middleware-platform/tests/test-email-booking-api.js`

**Usage:**
```bash
# Start server first
cd middleware-platform
npm start

# In another terminal
node tests/test-email-booking-api.js your-email@example.com
```

## What to Verify

### 1. Appointment Creation
- ✅ Appointment is created in database
- ✅ Appointment has correct patient email
- ✅ Appointment has all required fields

### 2. Email Sending
- ✅ Email service is called
- ✅ Email is sent successfully (or logged to console if no email service configured)
- ✅ Email provider is identified (smtp, azure, or console)

### 3. Email Content
The email should contain:
- ✅ Patient name
- ✅ Date & Time (formatted)
- ✅ Appointment type
- ✅ Duration
- ✅ Provider name
- ✅ Confirmation number
- ✅ Calendar link (if Google Calendar is configured)
- ✅ Instructions about reminders

### 4. Email Subject
- ✅ Subject: "Appointment Confirmed - [Date & Time]"

## Email Service Configuration

### Check Current Configuration

The system supports multiple email providers:

1. **Azure Communication Services** (Priority 1)
   - Requires: `AZURE_COMMUNICATION_CONNECTION_STRING`
   - Sender: `AZURE_EMAIL_SENDER`

2. **SMTP** (Priority 2)
   - Requires: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`
   - Optional: `SMTP_PORT`, `SMTP_FROM`

3. **Console Logging** (Fallback)
   - If no email service is configured, emails are logged to console
   - Check server logs for email content

### Test Email Configuration

To verify email configuration, check:
```bash
# Check environment variables
echo $SMTP_HOST
echo $SMTP_USER
echo $AZURE_COMMUNICATION_CONNECTION_STRING
```

## Troubleshooting

### Email Not Sent

1. **Check server logs** for email errors
2. **Verify email configuration** (SMTP or Azure)
3. **Check email service logs** in console output
4. **Verify patient_email** is provided in appointment data

### Email in Console Mode

If `emailProvider: "console"`:
- No email service is configured
- Email content is logged to server console
- Check server logs for email HTML content
- This is normal in development mode

### Email Sent but Not Received

1. **Check spam folder**
2. **Verify email address** is correct
3. **Check email service logs** for delivery status
4. **Verify sender address** is not blocked

## Expected Email Template

The confirmation email includes:

```html
Subject: Appointment Confirmed - [Date & Time]

Dear [Patient Name],

Your appointment has been successfully scheduled!

Date & Time: [Formatted Date/Time]
Type: [Appointment Type]
Duration: [Duration] minutes
Provider: [Provider Name]
Confirmation Number: [Appointment ID]

[Add to Calendar Button - if Google Calendar configured]

You will receive a reminder email 1 hour before your appointment.

Best regards,
DocLittle Mental Health Team
```

## Test Checklist

- [ ] Server is running
- [ ] Test endpoint is accessible
- [ ] Appointment is created in database
- [ ] Email is sent (or logged to console)
- [ ] Email contains all required information
- [ ] Email subject is correct
- [ ] Confirmation number is included
- [ ] Date/time is formatted correctly

## Next Steps

After testing:
1. Verify email is received in inbox
2. Check email content matches appointment details
3. Test with real voice agent call
4. Monitor email delivery in production

