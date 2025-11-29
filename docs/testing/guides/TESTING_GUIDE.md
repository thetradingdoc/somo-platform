# Testing Guide - CRM & Agent Calling

## Quick Start Testing

### Step 1: Start the Server

```bash
cd middleware-platform
npm start
```

Server should run on `http://localhost:4000`

---

## Step 2: Test the CRM Pages

### A. Lead Generator (`/admin/leads.html`)
**URL:** `http://localhost:4000/admin/leads.html`

**What to Test:**
1. ✅ Search for clinics
   - Enter query: "medical clinics"
   - Location: "US,NY"
   - Click "Search Clinics"
   - Should show clinic results

2. ✅ Save a lead
   - Click "Save Lead" on a result
   - Should see success message
   - Lead appears in "Saved Clinic Leads" section

3. ✅ Extract contact info
   - If lead has source_url but no phone/email
   - Click "Extract Contact"
   - Should extract phone/email from website

4. ✅ Trigger agent call
   - Find a qualified lead (has phone + email)
   - Click "🤖 Agent Call"
   - Should initiate call (if Retell configured)

### B. CRM Dashboard (`/admin/crm.html`)
**URL:** `http://localhost:4000/admin/crm.html`

**What to Test:**
1. ✅ View pipeline stats
   - Should show: Total Leads, Qualified Leads, Calls, Pipeline Value
   - Numbers should match your database

2. ✅ View pipeline stages
   - Should see 8 stages (New, Contacted, Qualified, etc.)
   - Each stage should show lead count
   - Lead cards should appear in each stage

3. ✅ Click on lead card
   - Should navigate to lead details page

### C. Pipeline View (`/admin/pipeline.html`)
**URL:** `http://localhost:4000/admin/pipeline.html`

**What to Test:**
1. ✅ View Kanban board
   - Should see all pipeline stages
   - Leads in correct stages

2. ✅ View lead details
   - Click on any lead card
   - Modal should show lead info
   - Should see call history

3. ✅ Trigger call from pipeline
   - Click lead card
   - Click "🤖 Agent Call" button
   - Should initiate call

### D. Lead Details (`/admin/crm-lead.html`)
**URL:** `http://localhost:4000/admin/crm-lead.html?id=LEAD_ID`

**What to Test:**
1. ✅ View lead information
   - All lead fields displayed
   - Contact information shown
   - Qualification status clear

2. ✅ View call history
   - Click "Activities" tab
   - Should see all calls
   - Should show call costs

3. ✅ Update lead
   - Edit notes
   - Change pipeline stage
   - Update should save

---

## Step 3: Test API Endpoints

### Check if API is working:

```bash
# Test health endpoint
curl http://localhost:4000/health

# Test leads endpoint (requires auth)
curl http://localhost:4000/api/admin/leads
```

### Test with Browser DevTools:
1. Open any CRM page
2. Open DevTools (F12)
3. Go to Network tab
4. Check API calls:
   - Should see calls to `/api/admin/leads/*`
   - Should return 200 status
   - Should have `success: true` in response

---

## Step 4: Test Agent Call (If Configured)

### Prerequisites:
- ✅ `RETELL_API_KEY` set in `.env`
- ✅ `RETELL_SALES_AGENT_ID` or `RETELL_AGENT_ID` set
- ✅ `TWILIO_PHONE_NUMBER` set (E.164 format)
- ✅ At least one qualified lead in database

### Test Steps:
1. Go to `/admin/leads.html`
2. Find a qualified lead (has phone + email)
3. Click "🤖 Agent Call"
4. Check console logs:
   ```
   📞 Initiating outbound call via Retell:
      Agent ID: agent_xxxxx
      From: +15551234567
      To: +15559876543
      Lead: Clinic Name
   ✅ Retell call created! Call ID: call_xxxxx
   ```
5. Check database:
   - `lead_calls` table should have new record
   - `call_status` should be 'initiated' or 'ringing'
   - `call_cost` should be estimated

---

## Step 5: Check Database

### View leads:
```bash
# If using SQLite
sqlite3 middleware-platform/database.sqlite

# Then run:
SELECT COUNT(*) FROM leads;
SELECT * FROM leads LIMIT 5;
SELECT * FROM lead_calls;
```

### Check call costs:
```sql
SELECT 
  l.clinic_name,
  COUNT(lc.id) as call_count,
  SUM(lc.call_cost) as total_cost
FROM leads l
LEFT JOIN lead_calls lc ON l.id = lc.lead_id
GROUP BY l.id
HAVING call_count > 0;
```

---

## Common Issues & Fixes

### Issue: "No leads showing"
**Fix:**
1. Check if you have leads in database
2. Go to `/admin/leads.html`
3. Search and save some leads first

### Issue: "API calls failing"
**Fix:**
1. Check server is running
2. Check browser console for errors
3. Verify API endpoints are correct (`/api/admin/leads/*`)

### Issue: "Call not initiating"
**Fix:**
1. Check `.env` has `RETELL_API_KEY`
2. Check `.env` has `TWILIO_PHONE_NUMBER`
3. Check lead is qualified (phone + email)
4. Check call limit not reached (250/month)

### Issue: "Costs not showing"
**Fix:**
1. Make sure calls have completed
2. Check `lead_calls.call_cost` in database
3. Refresh CRM page

---

## Test Checklist

- [ ] Server starts without errors
- [ ] Can access `/admin/leads.html`
- [ ] Can search for clinics
- [ ] Can save leads
- [ ] Can view leads in CRM dashboard
- [ ] Pipeline stages show correct counts
- [ ] Can click on lead cards
- [ ] Can view lead details
- [ ] Can trigger agent call (if configured)
- [ ] Call costs are tracked
- [ ] API endpoints return correct data

---

## Next Steps After Testing

1. **If everything works:**
   - Start using it!
   - Add more leads
   - Make calls
   - Track results

2. **If something doesn't work:**
   - Check error messages
   - Review logs
   - Let me know what's broken

3. **If you want improvements:**
   - Tell me what's missing
   - What looks off
   - What should work better

---

## Quick Test Commands

```bash
# Start server
cd middleware-platform && npm start

# Check if running
curl http://localhost:4000/health

# View logs
tail -f middleware-platform/logs/*.log

# Check database
sqlite3 middleware-platform/database.sqlite "SELECT COUNT(*) FROM leads;"
```

---

**Ready to test! Let me know what you find.** 🚀

