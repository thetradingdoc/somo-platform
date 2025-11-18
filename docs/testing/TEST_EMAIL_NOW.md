# 🧪 Test Email Booking - Instructions

## ⚠️ Important: Server Restart Required

The test endpoint has been added to the code, but **you need to restart your server** for it to be available.

## Option 1: Use Test Endpoint (After Restart)

**Restart your server first:**
```bash
# Stop current server (Ctrl+C or kill process)
# Then restart:
cd middleware-platform
npm start
```

**Then test:**
```bash
curl -X POST http://localhost:4000/api/test/appointment-email \
  -H "Content-Type: application/json" \
  -d '{
    "patient_email": "test@example.com",
    "patient_name": "Test Patient",
    "appointment_type": "Cardiology Consultation",
    "date": "2025-11-15",
    "time": "2:00 PM"
  }'
```

## Option 2: Use Existing Endpoint (Works Now)

**Test using the existing voice appointments endpoint:**
```bash
curl -X POST http://localhost:4000/voice/appointments/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "patient_name": "Test Patient Email",
    "patient_phone": "+15551234567",
    "patient_email": "test@example.com",
    "appointment_type": "Cardiology Consultation",
    "date": "2025-11-15",
    "time": "2:00 PM",
    "timezone": "America/New_York"
  }'
```

**Watch your server logs** - you should see:
- `📋 Scheduling appointment...`
- `✅ Appointment saved to database`
- `✅ Confirmation email sent` (or email logged to console)

## What to Look For in Logs

1. **Appointment Creation:**
   ```
   📋 Scheduling appointment for Test Patient Email (test@example.com) on 2025-11-15 at 2:00 PM
   ✅ Appointment saved to database
   ```

2. **Email Sending:**
   ```
   ✅ Confirmation email sent
   📧 Email sent via SMTP: [messageId]
   ```
   OR if no email service:
   ```
   📧 EMAIL (SIMULATED):
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   To: test@example.com
   Subject: Appointment Confirmed - [Date & Time]
   [Email HTML content]
   ```

3. **Email Content Should Include:**
   - Patient name
   - Date & Time
   - Appointment type
   - Confirmation number
   - Provider name

## Check Server Logs

The server logs will show:
- ✅ Appointment creation
- ✅ Email sending attempt
- ✅ Email provider used (smtp/azure/console)
- ✅ Full email content (if console mode)

---

**The endpoint is now in the code and will work after you restart the server!**

