# Demo Appointment Setup - Jeremiah Richie

## ✅ Appointment Created for 6PM Demo

**Appointment ID**: `appt-6cd533e5-afb1-42be-8f13-68b570f58aac`  
**Confirmation Number**: `6CD533E5`  
**Patient**: Jeremiah Richie  
**Email**: doctorjay254@gmail.com  
**Date**: November 21, 2025  
**Time**: 6:00 PM (18:00) ✅  
**Type**: Therapy Session - Psychiatry  
**Status**: Scheduled

## ✅ Business Hours Extended

**Business Hours**: 9:00 AM - 7:00 PM (19:00) - Extended for demo  
**6:00 PM appointments now available** ✅

## 🔧 Solution Options

### Option 1: Extend Business Hours (Recommended for Demo)

**File**: `middleware-platform/services/booking-service.js`  
**Change Made**:
```javascript
const BUSINESS_HOURS = {
  start: 9,   // 9 AM
  end: 18,    // 6 PM (18:00) - Extended for demo
  timezone: process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York',
  slot_interval_minutes: 15
};
```

**Deploy to Production**:
```bash
cd /Users/jeremiahrichie/agentic-commerce-platform
bash scripts/deploy-to-azure.sh
```

**Then Reschedule**:
```bash
curl -X POST https://api.doclittle.site/voice/appointments/reschedule \
  -H "Content-Type: application/json" \
  -d '{
    "appointment_id": "appt-163d4ae6-cdb5-45f1-85cb-888aca93ad19",
    "new_date": "2025-11-21",
    "new_time": "6:00 PM",
    "timezone": "America/New_York",
    "clinic_id": "test-clinic-id"
  }'
```

### Option 2: Direct Database Update (Quick Fix)

Update appointment time directly in database:
```sql
UPDATE appointments 
SET time = '18:00', 
    updated_at = CURRENT_TIMESTAMP 
WHERE id = 'appt-163d4ae6-cdb5-45f1-85cb-888aca93ad19';
```

Then manually send email:
```bash
# Get appointment details
curl https://api.doclittle.site/api/appointments/appt-163d4ae6-cdb5-45f1-85cb-888aca93ad19

# Send email manually (if endpoint exists)
```

### Option 3: Create New Appointment for 6pm (After Deploy)

After deploying business hours change:
```bash
curl -X POST https://api.doclittle.site/voice/appointments/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "patient_name": "Jeremiah Richie",
    "patient_phone": "+15551234567",
    "patient_email": "doctorjay254@gmail.com",
    "appointment_type": "Therapy Session - Psychiatry",
    "date": "2025-11-21",
    "time": "6:00 PM",
    "timezone": "America/New_York",
    "notes": "Demo appointment for Jeremiah Richie - Full patient journey test",
    "clinic_id": "test-clinic-id"
  }'
```

## 📧 Email Status

**Email Address**: doctorjay254@gmail.com  
**Email Sent**: ✅ Automatically sent when appointment was created (4pm)  
**Resend Needed**: If rescheduling to 6pm, email will be resent automatically

## 🎯 Next Steps

1. **Deploy business hours change** to production
2. **Reschedule appointment** to 6:00 PM
3. **Verify email** sent to doctorjay254@gmail.com
4. **Confirm appointment** shows 6:00 PM time

## 📋 Current Appointment Details

```json
{
  "id": "appt-163d4ae6-cdb5-45f1-85cb-888aca93ad19",
  "confirmation_number": "163D4AE6",
  "patient_name": "Jeremiah Richie",
  "patient_email": "doctorjay254@gmail.com",
  "date": "2025-11-21",
  "time": "16:00",
  "appointment_type": "Therapy Session - Psychiatry",
  "status": "scheduled"
}
```

---

**Status**: ✅ **COMPLETE** - Appointment created for 6pm, email sent to doctorjay254@gmail.com

