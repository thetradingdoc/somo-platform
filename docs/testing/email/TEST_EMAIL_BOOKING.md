# 🧪 Test Appointment Email Booking

## Quick Test Instructions

### Step 1: Start the Server
```bash
cd middleware-platform
npm start
```

### Step 2: Test via cURL

**Replace `your-email@example.com` with your actual email:**

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

### Step 3: Check Results

**Expected Response:**
```json
{
  "success": true,
  "emailSent": true,
  "emailProvider": "smtp" | "azure" | "console",
  "appointment": {
    "confirmation_number": "ABC12345",
    "patient_email": "your-email@example.com"
  }
}
```

**What to Verify:**
1. ✅ `success: true` - Appointment created
2. ✅ `emailSent: true` - Email was sent
3. ✅ Check your email inbox
4. ✅ Email contains appointment details

### Step 4: Verify Email Content

The email should include:
- ✅ Patient name
- ✅ Date & Time
- ✅ Appointment type
- ✅ Confirmation number
- ✅ Provider name

## Email Service Status

**If `emailProvider: "console"`:**
- No email service configured
- Email logged to server console
- Check server logs for email HTML

**If `emailProvider: "smtp"` or `"azure"`:**
- Email sent via configured service
- Check inbox (and spam folder)

## Troubleshooting

**Email not received?**
1. Check spam folder
2. Check server logs
3. Verify email address
4. Check email service config

---

**Full Documentation:** `docs/testing/TEST_APPOINTMENT_EMAIL.md`
