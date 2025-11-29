# Voice Agent Implementation Guide

Complete guide for implementing and configuring the voice agent system.

## ✅ Implementation Status

### 1. **Outbound Call API Integration**
- ✅ `RetellService.createOutboundCall()` - Creates outbound calls via Retell API
- ✅ Phone number formatting (E.164 format)
- ✅ Metadata passing (lead info, clinic name, location)
- ✅ Error handling and logging

### 2. **Call Initiation Endpoint**
- ✅ `POST /api/admin/jobs/:id/call` - Fully implemented
- ✅ Checks qualification (phone + email + clinic)
- ✅ Enforces 250 calls/month limit
- ✅ Creates call record in database
- ✅ Actually calls Retell API to initiate call
- ✅ Updates lead pipeline stage
- ✅ Creates activity log

### 3. **Sales Agent Prompt**
- ✅ Created sales-specific prompt: `docs/voice-agent/sales-agent-prompt.md`
- ✅ Professional sales script
- ✅ Handles objections, schedules demos
- ✅ Respectful and non-pushy

### 4. **Call Tracking & Webhooks**
- ✅ WebSocket handler updates lead calls on call end
- ✅ Retell webhook (`/webhook/retell/events`) handles call completion
- ✅ Calculates actual call cost from duration
- ✅ Updates lead pipeline based on outcomes
- ✅ Activity timeline tracking

### 5. **Database & CRM**
- ✅ Lead qualification system (phone + email + clinic)
- ✅ Pipeline stages (8 stages)
- ✅ Call cost tracking
- ✅ Activity logging
- ✅ Follow-up management

## 🔧 Configuration

### Required Environment Variables:
```bash
# Retell API (required)
RETELL_API_KEY=your_retell_api_key

# Sales Agent ID (use existing or create new)
RETELL_SALES_AGENT_ID=agent_xxxxx  # OR use RETELL_AGENT_ID

# Twilio Phone Number (your number that makes calls)
TWILIO_PHONE_NUMBER=+15551234567  # Must be E.164 format
```

### Steps to Get Agent Working:

1. **Create Sales Agent in Retell** (if using dedicated agent):
   ```bash
   # Run the configure script to create/update agent
   node middleware-platform/configure-retell.js
   ```
   - Or create manually in Retell dashboard
   - Use the sales prompt from `docs/voice-agent/sales-agent-prompt.md`
   - Set WebSocket URL to: `wss://api.doclittle.site/retell-llm`

2. **Set Environment Variables**:
   ```bash
   # In your .env file
   RETELL_SALES_AGENT_ID=agent_xxxxx  # Your sales agent ID
   TWILIO_PHONE_NUMBER=+15551234567    # Your Twilio number
   ```

3. **Test the Flow**:
   - Go to CRM: `/admin/crm.html`
   - Find a qualified lead (has phone + email + is clinic)
   - Click "Agent Call" button
   - Check logs for call creation
   - Monitor call status

## 🚨 Critical Requirements

### Must Have:
- ✅ `RETELL_API_KEY` - Your Retell API key
- ✅ `RETELL_SALES_AGENT_ID` or `RETELL_AGENT_ID` - Agent to use
- ✅ `TWILIO_PHONE_NUMBER` - Your Twilio number (E.164 format: +15551234567)

### Must Configure in Retell:
- Agent WebSocket URL must point to: `wss://api.doclittle.site/retell-llm`
- Agent must have sales prompt configured
- Agent must be active/enabled

## 🎯 How It Works

1. **User clicks "Agent Call" in CRM**
   - Checks lead is qualified (phone + email + clinic)
   - Checks 250/month call limit
   - Creates call record

2. **System calls Retell API**
   - `POST /v2/create-phone-call`
   - Passes agent_id, from_number, to_number
   - Retell initiates the call

3. **Call happens**
   - Agent speaks sales script
   - Handles conversation
   - Can schedule demos, collect info

4. **Call ends**
   - WebSocket closes or webhook fires
   - System updates call record with duration/cost
   - Updates lead pipeline based on outcome
   - Creates activity log

5. **You see results**
   - In CRM: See call status, duration, cost
   - In Lead Details: See full call history
   - In Pipeline: See leads move through stages

## 📋 Code Changes Made

### Files Modified:
1. **`services/retell-service.js`**
   - Added `createOutboundCall()` method

2. **`routes/admin-jobs.js`**
   - Replaced TODO with actual Retell API call
   - Added webhook handler for call events
   - Added call completion logic

3. **`webhooks/retell-websocket.js`**
   - Added lead call update on WebSocket close

4. **`database.js`**
   - Added `is_qualified` field and auto-qualification
   - Added `lead_activities` table
   - Added activity tracking functions

## 📊 Next Steps to Scale

1. **Add Sales Functions** (optional):
   - `schedule_demo` - Book demo in calendar
   - `collect_interest` - Capture interest level
   - `send_proposal` - Trigger proposal email

2. **Optimize Agent Script**:
   - Test different approaches
   - A/B test scripts
   - Refine based on real conversations

3. **Automate Follow-ups**:
   - Auto-schedule follow-up calls
   - Send emails based on call outcomes
   - Trigger workflows

4. **Analytics**:
   - Track conversion rates
   - Monitor cost per qualified lead
   - Optimize pipeline stages

## 🎯 Success Metrics

Track these to optimize:
- **Call connection rate** - % of calls that connect
- **Demo booking rate** - % that schedule demos
- **Qualification rate** - % that move to "Qualified" stage
- **Cost per qualified lead** - Total call costs / qualified leads
- **Pipeline conversion** - % that move through stages

## ✅ Ready Checklist

Before first call:
- [ ] `RETELL_API_KEY` is set and valid
- [ ] `RETELL_SALES_AGENT_ID` or `RETELL_AGENT_ID` is set
- [ ] `TWILIO_PHONE_NUMBER` is set in E.164 format
- [ ] Retell agent WebSocket URL points to your server
- [ ] You have at least one qualified lead (phone + email + clinic)
- [ ] Call limit not reached (250/month)
- [ ] Test with one lead first before bulk calling

---

**Status**: ✅ Ready to use  
**Last Updated**: November 2024

