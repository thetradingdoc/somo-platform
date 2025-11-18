# Email Service Documentation

Complete documentation for email functionality, debugging, and diagnostics.

---

## 📚 Documentation Index

### Setup & Configuration

1. **EMAIL_DEBUGGING_GUIDE.md** 🔍 **MAIN GUIDE**
   - How to debug email issues
   - Test endpoints
   - Configuration options
   - Troubleshooting workflow

### Diagnostics & Testing

2. **EMAIL_DIAGNOSTICS_REPORT.md** 📊 **DIAGNOSTICS**
   - Email service status report
   - Configuration analysis
   - Test results summary
   - Current status

---

## 🚀 Quick Start

### Check Email Status
```bash
curl http://localhost:4000/api/test/email/status
```

### Test Email Send
```bash
curl -X POST http://localhost:4000/api/test/email/send \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","subject":"Test","html":"<p>Test</p>"}'
```

### Run Comprehensive Test
```bash
node tests/test-email-comprehensive.js
```

---

## 📧 Email Configuration

### Current Setup
- **Provider:** Azure Communication Services ✅
- **Domain:** doclittle.site ✅
- **Sender:** DoNotReply@doclittle.site ✅
- **Status:** Production Ready ✅

### Email Types
1. ✅ Appointment Confirmation
2. ✅ Insurance Billing
3. ✅ Patient Billing
4. ✅ Checkout Verification

---

## 🔍 Debugging

### Common Issues

**Emails not sending?**
- Check Azure configuration: `../azure/README.md`
- Verify sender address is verified
- Check connection string in `.env`

**Simulation mode?**
- Configure Azure or SMTP
- See setup guides in `../azure/` or `../setup/`

**Email endpoint 404?**
- Restart server to load routes
- Check server is running

---

## 📋 Test Endpoints

All endpoints under `/api/test/email/`:

- `GET /api/test/email/status` - Check configuration
- `POST /api/test/email/send` - Send test email
- `POST /api/test/email/appointment` - Test appointment email
- `POST /api/test/email/insurance-billing` - Test insurance billing
- `POST /api/test/email/patient-billing` - Test patient billing
- `POST /api/test/email/checkout` - Test checkout email
- `POST /api/test/email/all` - Test all email types

---

## 🔗 Related Documentation

- **Azure Setup:** `../azure/README.md`
- **Testing:** `../testing/README.md`
- **Main Docs:** `../README.md`

---

**Last Updated:** November 15, 2025

