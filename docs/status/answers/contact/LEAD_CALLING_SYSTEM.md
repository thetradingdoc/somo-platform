# Lead Calling System - Implementation Summary

## ✅ What's Built

### 1. **Leads Table** (replaces jobs table)
- Stores leads from job search
- Fields: `clinic_name`, `clinic_phone`, `clinic_email`, `location`, `source_url`, `status`, `priority`
- Tracks: `call_count`, `last_called_at`

### 2. **Lead Calls Table**
- Tracks all outbound calls to leads
- Fields: `call_id`, `call_status`, `call_duration_seconds`, `call_cost`
- **Call cost tracking**: Calculated as `duration_minutes * $0.05/min`

### 3. **Monthly Call Limit (250/month)**
- `monthly_call_usage` table tracks calls per billing month
- **Automatic limit enforcement**: Blocks calls when 250/month reached
- Endpoint: `GET /api/admin/jobs/stats/usage` shows remaining calls

### 4. **API Endpoints**
- `GET /api/admin/jobs/search` - Search for jobs (Google Jobs)
- `POST /api/admin/jobs/save` - Save lead to database
- `GET /api/admin/jobs` - List all leads (with call usage stats)
- `GET /api/admin/jobs/:id` - Get lead details
- `POST /api/admin/jobs/:id/call` - **Initiate call (checks 250 limit)**
- `PUT /api/admin/jobs/:id` - Update lead (add phone/email)
- `GET /api/admin/jobs/stats/usage` - Call usage stats

### 5. **Admin UI** (`/admin/jobs.html`)
- Search interface for jobs
- Save leads to database
- View saved leads
- Call clinic button (with limit checking)
- Shows remaining calls

## ⚠️ Current Issue: Phone/Email Extraction

**Problem**: Google Jobs API doesn't return phone/email directly
- Current results show: `clinic_phone: null`, `clinic_email: null`
- We have `source_url` which links to the job posting page

**Solution Needed**: 
1. Scrape the `source_url` to extract phone/email
2. Or use a service like SerpAPI's "extract" feature
3. Or manually add phone/email via the admin UI

## 📊 Call Cost Tracking

- **Cost per minute**: $0.05 (Retell + Twilio + infrastructure)
- **Tracked in**: `lead_calls.call_cost`
- **Calculated**: `(duration_seconds / 60) * 0.05`
- **Included in invoices**: Lead call costs are added to base costs

## 🎯 Smart Calling Strategy (250 calls/month)

1. **Priority system**: Leads have `priority` field (1-10, default 5)
2. **Filter by phone**: Only call leads with `clinic_phone` set
3. **Call limit check**: Automatically blocks if 250/month reached
4. **Usage tracking**: Real-time stats show remaining calls

## 🔄 Next Steps

1. **Phone/Email Extraction**: 
   - Scrape `source_url` pages to get contact info
   - Or integrate with a contact extraction service

2. **Retell Integration**: 
   - Wire actual outbound calling in `POST /api/admin/jobs/:id/call`
   - Configure agent script: "I'm an AI voice assistant applying for the roles listed on your site..."

3. **Webhook Handler**: 
   - Update call status when Retell sends completion events
   - Recalculate actual call cost from duration

