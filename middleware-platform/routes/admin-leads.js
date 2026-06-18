/**
 * ADMIN LEAD GENERATION ROUTES
 *
 * Purpose:
 * - Allow admins to search for medical clinics and healthcare facilities
 *   to sell software to (e.g., via Google search)
 * - Results are used by the admin UI to drive outbound agent sales calls.
 * - The agent calls clinics to sell the medical billing software.
 *
 * Endpoint:
 * - GET /api/admin/leads/search?q=&location=&days=
 */

const express = require('express');
const { searchJobs } = require('../services/job-scraper');
const { extractContactInfo } = require('../services/contact-extractor');
const leadIngestion = require('../services/lead-ingestion');
const { buildLanguageInstruction, parseRequiredLanguages, extractLanguagesFromJob } = require('../services/lead-language-extractor');
const { requireAdminOrCapability } = require('../middleware/admin-auth');
const { adminLimiter } = require('../middleware/rate-limiter');
const RetellService = require('../services/retell-service');
const db = require('../database');

const router = express.Router();
const retellService = new RetellService();

/**
 * GET /api/admin/leads/search
 *
 * Query params:
 * - q         : search query (default: "medical clinics")
 * - location  : location string, e.g. "US,NY" (default: "US,NY")
 * - days      : how many days back to search (default: 1, not really used for clinic search)
 *
 * Response:
 * {
 *   success: true,
 *   leads: [ ...normalized clinic leads... ],
 *   meta: { query, location, days }
 * }
 */
router.get('/search', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const {
      q = 'medical clinics',
      location = 'US,NY',
      days
    } = req.query;

    const postedSinceDays = days ? parseInt(days, 10) || 1 : 1;

    const leads = await searchJobs({
      query: q,
      location,
      postedSinceDays
    });

    res.json({
      success: true,
      leads,
      meta: {
        query: q,
        location,
        days: postedSinceDays
      }
    });
  } catch (error) {
    console.error('❌ Admin lead search error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to search leads',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/save
 * Save a lead from search results to the database
 * Automatically extracts contact info if source_url is provided
 */
router.post('/save', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const leadData = req.body;

    // Check if lead already exists by external_id
    if (leadData.external_id) {
      const existing = db.getLeadByExternalId(leadData.external_id);
      if (existing) {
        return res.json({
          success: true,
          message: 'Lead already exists',
          lead: existing
        });
      }
    }

    const jobLike = {
      ...leadData,
      source_url: leadData.source_url,
      clinic_name: leadData.clinic_name,
      location: leadData.location,
    };
    const enriched = await leadIngestion.enrichJobCandidate(jobLike);

    if (!leadIngestion.isCallableLead(enriched)) {
      return res.status(422).json({
        success: false,
        error: 'Lead has no callable phone number after enrichment',
      });
    }

    leadData.clinic_phone = enriched.clinic_phone;
    leadData.clinic_email = enriched.clinic_email || leadData.clinic_email;
    leadData.opening_hours = enriched.opening_hours || leadData.opening_hours;
    leadData.source_url = enriched.source_url;
    leadData.notes = leadIngestion.buildNotesWithJobPosting(enriched.job_posting_url, leadData.notes);
    const lang = extractLanguagesFromJob({
      title: leadData.title,
      description: leadData.description,
    });
    leadData.required_languages = lang.required_languages.length
      ? JSON.stringify(lang.required_languages)
      : null;
    leadData.preferred_language = lang.preferred_language;
    const extractedContacts = {
      phone: enriched.clinic_phone,
      email: enriched.clinic_email,
      openingHours: enriched.opening_hours,
    };

    const result = db.createLead(leadData);
    const lead = db.getLead(result.lastInsertRowid || leadData.id);

    // Auto-score the new lead
    try {
      const LeadIntelligenceService = require('../services/lead-intelligence-service');
      LeadIntelligenceService.updateLeadScore(lead.id);
      // Refresh lead to get updated score
      const updatedLead = db.getLead(lead.id);
      if (updatedLead) {
        Object.assign(lead, updatedLead);
      }
    } catch (scoreError) {
      console.warn('⚠️  Auto-scoring failed for new lead:', scoreError.message);
      // Continue anyway - scoring is not critical
    }

    res.json({
      success: true,
      message: 'Lead saved successfully',
      lead,
      extracted_contacts: extractedContacts.phone || extractedContacts.email ? extractedContacts : null
    });
  } catch (error) {
    console.error('❌ Save lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save lead',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads
 * Get all saved leads (with optional filters)
 */
router.get('/', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { status, clinic_name, has_phone, has_contact, limit, show_all, show_test, include_test, lead_type } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (clinic_name) filters.clinic_name = clinic_name;
    if (has_phone === 'true') filters.has_phone = true;
    // Default: only show leads with contact info (phone OR email)
    // Set show_all=true to see all leads including those without contact info
    if (show_all !== 'true') {
      filters.has_contact = true;
    }
    if (limit) filters.limit = parseInt(limit, 10);

    // Filter by lead_type: 'sales' (outbound sales leads) or 'customer' (inbound signups)
    if (lead_type === 'sales' || lead_type === 'customer') {
      filters.lead_type = lead_type;
    }
    if (req.query.source) filters.source = req.query.source;

    // Handle test leads filter
    // Default: exclude test leads (handled in getAllLeads)
    if (show_test === 'true') {
      filters.show_test = true; // Show only test leads
    } else if (include_test === 'true') {
      filters.include_test = true; // Include both test and production
    }

    const leads = db.getAllLeads(filters);

    // Get call counts and next activity for each lead
    const leadsWithCalls = leads.map(lead => {
      const calls = db.getLeadCallsByLeadId(lead.id);

      // Get next activity (scheduled activities from lead_activities)
      const activities = db.getLeadActivities(lead.id, { limit: 10 });
      const scheduledActivity = activities.find(a => {
        try {
          const metadata = a.metadata ? JSON.parse(a.metadata) : {};
          return metadata.status === 'scheduled' && metadata.scheduled_date;
        } catch {
          return false;
        }
      });

      // Determine next activity date (prioritize follow_up_date, then scheduled activity)
      let nextActivityDate = lead.follow_up_date || null;
      if (scheduledActivity) {
        try {
          const metadata = JSON.parse(scheduledActivity.metadata || '{}');
          if (metadata.scheduled_date) {
            const scheduledDate = new Date(metadata.scheduled_date);
            if (!nextActivityDate || scheduledDate < new Date(nextActivityDate)) {
              nextActivityDate = scheduledDate.toISOString();
            }
          }
        } catch { }
      }

      // Get labels for this lead
      const labels = db.getLabelsForLead(lead.id);

      return {
        ...lead,
        call_count: calls.length,
        last_call_at: calls.length > 0 ? calls[0].created_at : null,
        next_activity_date: nextActivityDate,
        next_action: lead.next_action || null,
        labels: labels || []
      };
    });

    // Get call usage stats
    const callStats = db.getCallUsageStats();

    res.json({
      success: true,
      leads: leadsWithCalls,
      total: leadsWithCalls.length,
      call_usage: {
        calls_used: callStats.calls_used,
        calls_remaining: callStats.calls_remaining,
        limit: 250
      }
    });
  } catch (error) {
    console.error('❌ Get leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get leads',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/:id/call
 * Initiate an outbound call to a clinic for a lead
 * Checks monthly call limit (250/month) before initiating
 */
router.post('/:id/call', requireAdminOrCapability('platform.leads'), adminLimiter, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { schedule_type = 'instant' } = req.body || {};
    const lead = db.getLead(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    if (!leadIngestion.isCallableLead(lead)) {
      return res.status(400).json({
        success: false,
        error: 'Clinic phone number not callable for this lead. Need a valid 10-digit US phone before outbound call.',
        code: 'LEAD_NOT_CALLABLE',
      });
    }

    // Secondary guard: monthly_call_usage 250/mo cap (primary billing is usage_events via retell-websocket)
    const now = new Date();
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    try {
      db.incrementCallUsage(billingMonth);
    } catch (limitError) {
      return res.status(429).json({
        success: false,
        error: 'Monthly call limit reached',
        message: limitError.message
      });
    }

    // Create call record
    const { v4: uuidv4 } = require('uuid');
    const callId = `call_${Date.now()}_${uuidv4().substring(0, 8)}`;

    const callRecord = db.createLeadCall({
      lead_id: id,
      call_id: callId,
      call_status: 'initiated',
      notes: `Outbound call to ${lead.clinic_name} for job: ${lead.title}`
    });

    // Calculate estimated call cost (voice minutes * cost per minute)
    // Default: ~$0.05/min (Retell + Twilio + infrastructure)
    const callCostPerMinute = 0.05;
    const estimatedDuration = 5; // Default 5 minutes
    const estimatedCost = estimatedDuration * callCostPerMinute;

    // Update call record with estimated cost
    const callRecordId = callRecord.lastInsertRowid || callRecord.id;
    db.updateLeadCall(callRecordId, {
      call_cost: estimatedCost
    });

    // Update lead call count and last called timestamp
    db.updateLead(id, {
      call_count: (lead.call_count || 0) + 1,
      last_called_at: new Date().toISOString(),
      status: 'contacted',
      pipeline_stage: lead.pipeline_stage === 'new' ? 'contacted' : lead.pipeline_stage
    });

    // Handle scheduling
    if (schedule_type === 'weekly' || schedule_type === 'monthly') {
      // TODO: Implement background job scheduler for weekly/monthly calls
      // For now, create a scheduled activity record
      const scheduleDate = new Date();
      if (schedule_type === 'weekly') {
        scheduleDate.setDate(scheduleDate.getDate() + 7);
      } else if (schedule_type === 'monthly') {
        scheduleDate.setMonth(scheduleDate.getMonth() + 1);
      }

      db.createLeadActivity({
        lead_id: id,
        activity_type: 'call',
        activity_subject: `Call Scheduled (${schedule_type})`,
        activity_description: `Scheduled ${schedule_type} call to ${lead.clinic_name} for ${scheduleDate.toISOString().split('T')[0]}`,
        created_by: req.user?.id || 'system',
        metadata: JSON.stringify({
          schedule_type: schedule_type,
          scheduled_date: scheduleDate.toISOString(),
          status: 'scheduled'
        })
      });

      db.updateLead(id, {
        follow_up_date: scheduleDate.toISOString(),
        next_action: `Scheduled ${schedule_type} call`
      });

      const callStats = db.getCallUsageStats();
      return res.json({
        success: true,
        message: `Call scheduled for ${schedule_type} cadence`,
        schedule: scheduleDate.toISOString().split('T')[0],
        call_usage: {
          calls_used: callStats.calls_used,
          calls_remaining: callStats.calls_remaining,
          limit: 250
        },
        note: 'Scheduled calls will be processed by background job (coming soon)'
      });
    }

    // Actually initiate the call via Retell's outbound API (RECOMMENDED)
    // This avoids SIP authentication issues and is more reliable
    let retellCallId = null;
    try {
      // Get sales agent ID
      const salesAgentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;
      if (!salesAgentId) {
        throw new Error('RETELL_SALES_AGENT_ID or RETELL_AGENT_ID not configured. Please set in .env file.');
      }

      // Get Twilio from number (required by Retell)
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;
      if (!fromNumber) {
        throw new Error('TWILIO_PHONE_NUMBER not configured. Please set in .env file.');
      }

      // Format phone number (ensure E.164 format)
      let toNumber = lead.clinic_phone.trim();
      if (!toNumber.startsWith('+')) {
        // Assume US number if no country code
        if (toNumber.length === 10) {
          toNumber = `+1${toNumber}`;
        } else {
          toNumber = `+${toNumber}`;
        }
      }

      console.log(`📞 Initiating outbound call via Retell API:`);
      console.log(`   Agent ID: ${salesAgentId}`);
      console.log(`   From: ${fromNumber}`);
      console.log(`   To: ${toNumber}`);
      console.log(`   Lead: ${lead.clinic_name}`);

      // Prepare dynamic variables for the sales agent (accessible in prompt as {{clinic_name}}, etc.)
      const dynamicVariables = {
        clinic_name: lead.clinic_name || 'the clinic',
        lead_id: id,
        job_title: lead.title || 'Decision Maker',
        location: lead.location || 'your area',
        specialty: lead.specialty || 'General',
        lead_source: lead.source || 'job_search',
        preferred_language: lead.preferred_language || 'en',
        required_languages: parseRequiredLanguages(lead.required_languages).join(', ') || 'English only',
        language_instruction: buildLanguageInstruction(lead),
      };

      // Create outbound call via Retell API
      // Once SIP trunk is configured in Retell dashboard, this will work properly
      const { getOperatorCustomerId } = require('../services/voice-account-resolution');
      const operatorCustomerId = getOperatorCustomerId();

      const retellResponse = await retellService.createOutboundCall(
        salesAgentId,
        fromNumber,
        toNumber,
        {
          override_agent_id: salesAgentId,
          retell_llm_dynamic_variables: dynamicVariables,
          metadata: {
            lead_id: id,
            clinic_name: lead.clinic_name,
            clinic_email: lead.clinic_email,
            location: lead.location,
            preferred_language: lead.preferred_language || 'en',
            required_languages: parseRequiredLanguages(lead.required_languages).join(', '),
            call_type: 'sales_outbound',
            direction: 'outbound',
            ...(operatorCustomerId ? { customer_id: operatorCustomerId } : {})
          }
        }
      );

      retellCallId = retellResponse.call_id;
      console.log(`✅ Retell call created! Call ID: ${retellCallId}`);

      // Update call record with Retell call ID
      db.updateLeadCall(callRecordId, {
        call_id: retellCallId
      });

    } catch (retellError) {
      console.error('❌ Failed to initiate Retell outbound call:', retellError.message);
      if (retellError.response) {
        console.error(`   Status: ${retellError.response.status}`);
        console.error(`   Data:`, JSON.stringify(retellError.response.data, null, 2));
      }

      // Fallback: Try Twilio direct approach if Retell fails
      console.log('⚠️  Retell outbound failed, trying Twilio direct fallback...');
      try {
        const twilio = require('twilio');
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;

        if (accountSid && authToken && fromNumber) {
          let toNumber = lead.clinic_phone.trim();
          if (!toNumber.startsWith('+')) {
            if (toNumber.length === 10) {
              toNumber = `+1${toNumber}`;
            } else {
              toNumber = `+${toNumber}`;
            }
          }

          const { resolveTelephonyWebhookBase } = require('../utils/telephony-webhook-base');
          const { getOperatorCustomerId } = require('../services/voice-account-resolution');
          const apiBaseUrl = await resolveTelephonyWebhookBase();
          const operatorCustomerId = getOperatorCustomerId();
          const webhookUrl = new URL(`${apiBaseUrl}/voice/incoming`);
          webhookUrl.searchParams.set('lead_id', id);
          webhookUrl.searchParams.set('clinic_name', encodeURIComponent(lead.clinic_name || ''));
          webhookUrl.searchParams.set('call_type', 'sales_outbound');
          webhookUrl.searchParams.set('call_id', callId);
          if (operatorCustomerId) {
            webhookUrl.searchParams.set('customer_id', operatorCustomerId);
          }

          const twilioClient = twilio(accountSid, authToken);
          const call = await twilioClient.calls.create({
            from: fromNumber,
            to: toNumber,
            url: webhookUrl.toString(),
            method: 'POST',
            statusCallback: `${apiBaseUrl}/voice/status-callback`,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
          });

          const twilioCallSid = call.sid;
          console.log(`✅ Twilio fallback call created! Call SID: ${twilioCallSid}`);
          db.updateLeadCall(callRecordId, {
            call_id: twilioCallSid
          });
          retellCallId = twilioCallSid; // Use for response
        }
      } catch (twilioError) {
        console.error('❌ Twilio fallback also failed:', twilioError.message);
        // Don't fail the entire request - call record is already created
      }
    }

    // Create activity record
    db.createLeadActivity({
      lead_id: id,
      activity_type: 'call',
      activity_subject: 'Agent Call Initiated',
      activity_description: `Outbound sales call to ${lead.clinic_name}${retellCallId ? ` (Retell Call ID: ${retellCallId})` : ' (Call creation failed)'}`,
      created_by: req.user?.id || 'system',
      metadata: JSON.stringify({
        call_id: callId,
        retell_call_id: retellCallId,
        estimated_cost: estimatedCost,
        method: retellCallId ? 'retell_outbound_api' : 'failed'
      })
    });

    const callStats = db.getCallUsageStats();

    res.json({
      success: true,
      message: twilioCallSid ? 'Call initiated successfully' : 'Call record created, but Twilio call failed',
      call: {
        id: callRecordId,
        call_id: retellCallId || callId,
        retell_call_id: retellCallId,
        lead_id: id,
        status: retellCallId ? 'ringing' : 'initiated',
        estimated_cost: estimatedCost,
        method: retellCallId ? 'retell_outbound_api' : 'failed'
      },
      call_usage: {
        calls_used: callStats.calls_used,
        calls_remaining: callStats.calls_remaining,
        limit: 250
      },
      warning: retellCallId ? null : 'Call creation failed. Check logs and Retell/Twilio configuration.'
    });
  } catch (error) {
    console.error('❌ Initiate call error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate call',
      message: error.message
    });
  }
});

/**
 * PUT /api/admin/leads/calls/:callId
 * Update call status (e.g., when call completes)
 * Recalculates call cost based on actual duration
 */
router.put('/calls/:callId', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { callId } = req.params;
    const { call_status, call_duration_seconds, outcome, notes } = req.body;

    const call = db.getLeadCall(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    const updates = {};
    if (call_status) updates.call_status = call_status;
    if (call_duration_seconds !== undefined) {
      updates.call_duration_seconds = call_duration_seconds;
      // Recalculate cost based on actual duration ($0.05/min)
      updates.call_cost = (call_duration_seconds / 60) * 0.05;
    }
    if (outcome) updates.outcome = outcome;
    if (notes) updates.notes = notes;

    db.updateLeadCall(callId, updates);
    const updatedCall = db.getLeadCall(callId);

    // If call completed, update lead pipeline stage based on outcome
    if (call_status === 'completed' && call.lead_id) {
      const lead = db.getLead(call.lead_id);
      if (lead) {
        // Auto-advance pipeline based on outcome
        if (outcome === 'demo_scheduled' || outcome === 'interested') {
          db.updateLead(call.lead_id, {
            pipeline_stage: lead.pipeline_stage === 'contacted' ? 'qualified' :
              lead.pipeline_stage === 'qualified' ? 'demo' : lead.pipeline_stage
          });
        } else if (outcome === 'not_interested' || outcome === 'do_not_call') {
          db.updateLead(call.lead_id, {
            pipeline_stage: 'closed_lost',
            status: 'closed'
          });
        }
      }
    }

    res.json({
      success: true,
      message: 'Call updated successfully',
      call: updatedCall
    });
  } catch (error) {
    console.error('❌ Update call error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update call',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/calls/:callId/transcript
 */
router.get('/calls/:callId/transcript', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { callId } = req.params;
    const call = db.getLeadCall(callId);
    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    if (call.transcript_url) {
      try {
        const axios = require('axios');
        const resp = await axios.get(call.transcript_url, { timeout: 15000 });
        const data = resp.data;
        if (Array.isArray(data)) {
          return res.json({
            lines: data.map((line) => ({
              role: line.role || line.speaker || 'user',
              text: line.content || line.text || String(line),
            })),
          });
        }
        if (typeof data === 'string') {
          return res.json({ raw: data });
        }
        if (data?.transcript) {
          return res.json({ raw: data.transcript });
        }
      } catch (fetchErr) {
        console.warn('transcript_url fetch failed:', fetchErr.message);
      }
    }

    if (call.call_id) {
      try {
        const retellData = await retellService.getCall(call.call_id);
        const transcript = retellData?.transcript || retellData?.transcript_object;
        if (Array.isArray(transcript)) {
          return res.json({
            lines: transcript.map((line) => ({
              role: line.role === 'agent' ? 'agent' : 'user',
              text: line.content || line.text || '',
            })),
          });
        }
        if (typeof retellData?.transcript === 'string') {
          return res.json({ raw: retellData.transcript });
        }
      } catch (retellErr) {
        console.warn('Retell transcript fetch failed:', retellErr.message);
      }
    }

    res.json({ lines: [], raw: null });
  } catch (error) {
    console.error('transcript error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/leads/:id/enrich — alias for extract-contact (admin portal mockup)
 */
router.post('/:id/enrich', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = db.getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.source_url) return res.status(400).json({ error: 'No source_url' });

    const { phone, email, openingHours } = await extractContactInfo(
      lead.source_url,
      lead.clinic_name,
      lead.location
    );

    const updates = {};
    if (phone && !lead.clinic_phone) updates.clinic_phone = phone;
    if (email && !lead.clinic_email) updates.clinic_email = email;
    if (openingHours && !lead.opening_hours) updates.opening_hours = openingHours;
    if (Object.keys(updates).length > 0) db.updateLead(id, updates);

    res.json({ phone: phone || null, email: email || null, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/leads/webhooks/retell-call-event
 * Webhook endpoint for Retell call events (call_started, call_ended, etc.)
 * This is called by Retell when call status changes
 */
router.post('/webhooks/retell-call-event', async (req, res) => {
  try {
    const event = req.body;
    const { event_type, call_id, call_data } = event;

    console.log(`📞 Retell call event: ${event_type} for call ${call_id}`);

    // Find lead call by Retell call_id
    const leadCall = db.db.prepare('SELECT * FROM lead_calls WHERE call_id = ?').get(call_id);

    if (!leadCall) {
      console.warn(`⚠️  Lead call not found for Retell call_id: ${call_id}`);
      return res.json({ success: true, message: 'Call not found in database' });
    }

    // Update call based on event type
    if (event_type === 'call_started') {
      db.updateLeadCall(leadCall.id, {
        call_status: 'ringing'
      });
    } else if (event_type === 'call_answered') {
      db.updateLeadCall(leadCall.id, {
        call_status: 'in_progress'
      });
    } else if (event_type === 'call_ended' || event_type === 'call_completed') {
      const duration = call_data?.duration_seconds || null;
      const cost = duration ? (duration / 60) * 0.05 : null;

      db.updateLeadCall(leadCall.id, {
        call_status: 'completed',
        call_duration_seconds: duration,
        call_cost: cost
      });

      // Create activity
      db.createLeadActivity({
        lead_id: leadCall.lead_id,
        activity_type: 'call',
        activity_subject: 'Call Completed',
        activity_description: `Call completed. Duration: ${duration ? Math.round(duration / 60) : 'unknown'} minutes`,
        created_by: 'system',
        metadata: JSON.stringify({
          retell_call_id: call_id,
          duration_seconds: duration,
          cost: cost
        })
      });
    }

    res.json({ success: true, message: 'Event processed' });
  } catch (error) {
    console.error('❌ Retell webhook error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/stats/usage
 * Get current month call usage stats
 */
router.get('/stats/usage', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const stats = db.getCallUsageStats();
    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    console.error('❌ Get call usage stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get usage stats',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/pipeline/stats
 * Get pipeline statistics (leads by stage)
 */
router.get('/pipeline/stats', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const stats = db.getPipelineStats();
    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    console.error('❌ Get pipeline stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pipeline stats',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/pipeline/:stage
 * Get leads by pipeline stage
 */
router.get('/pipeline/:stage', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { stage } = req.params;
    const leads = db.getLeadsByPipelineStage(stage);

    // Ensure call_count is a number
    leads.forEach(lead => {
      lead.call_count = lead.call_count || 0;
      lead.total_call_cost = lead.total_call_cost || 0;
    });

    // Get call counts for each lead
    const leadsWithCalls = leads.map(lead => {
      const calls = db.getLeadCallsByLeadId(lead.id);
      return {
        ...lead,
        call_count: calls.length,
        last_call_at: calls.length > 0 ? calls[0].created_at : null
      };
    });

    res.json({
      success: true,
      stage,
      leads: leadsWithCalls,
      total: leadsWithCalls.length
    });
  } catch (error) {
    console.error('❌ Get pipeline stage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pipeline stage',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/pipeline/follow-up
 * Get leads needing follow-up
 */
router.get('/pipeline/follow-up', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const leads = db.getLeadsNeedingFollowUp();

    const leadsWithCalls = leads.map(lead => {
      const calls = db.getLeadCallsByLeadId(lead.id);
      return {
        ...lead,
        call_count: calls.length,
        last_call_at: calls.length > 0 ? calls[0].created_at : null
      };
    });

    res.json({
      success: true,
      leads: leadsWithCalls,
      total: leadsWithCalls.length
    });
  } catch (error) {
    console.error('❌ Get follow-up leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get follow-up leads',
      message: error.message
    });
  }
});

/**
 * PUT /api/admin/leads/:id/pipeline-stage
 * Move lead to a different pipeline stage and update lead details
 */
router.put('/:id/pipeline-stage', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { pipeline_stage, next_action, follow_up_date, notes, lead_score } = req.body;

    const lead = db.getLead(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    const updates = {};
    const oldStage = lead.pipeline_stage;

    if (pipeline_stage) updates.pipeline_stage = pipeline_stage;
    if (next_action !== undefined) updates.next_action = next_action;
    if (follow_up_date !== undefined) {
      updates.follow_up_date = follow_up_date || null;
    }
    if (lead_score !== undefined) {
      updates.lead_score = parseInt(lead_score, 10) || 0;
    }
    if (notes !== undefined && notes !== null && notes !== '') {
      const existingNotes = lead.notes || '';
      updates.notes = existingNotes ? `${existingNotes}\n\n[${new Date().toISOString()}] ${notes}` : notes;
    }

    db.updateLead(id, updates);

    // Create activity record for stage change
    if (pipeline_stage && pipeline_stage !== oldStage) {
      db.createLeadActivity({
        lead_id: id,
        activity_type: 'update',
        activity_subject: 'Pipeline Stage Changed',
        activity_description: `Moved from ${oldStage} to ${pipeline_stage}`,
        created_by: req.user?.id || 'system'
      });
    }

    const updatedLead = db.getLead(id);

    res.json({
      success: true,
      message: 'Lead updated successfully',
      lead: updatedLead
    });
  } catch (error) {
    console.error('❌ Update pipeline stage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update pipeline stage',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/activities/all
 * Get all activities across all leads (for activity feed)
 */
router.get('/activities/all', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { limit = 100, type } = req.query;

    // Get all leads first
    const allLeads = db.getAllLeads({ limit: 1000 });

    // Get activities for all leads
    const allActivities = [];
    for (const lead of allLeads.slice(0, 200)) { // Limit to 200 leads to avoid timeout
      try {
        const filters = { limit: 10 }; // Get last 10 activities per lead
        if (type) filters.activity_type = type;

        const activities = db.getLeadActivities(lead.id, filters);
        activities.forEach(act => {
          allActivities.push({
            ...act,
            lead_name: lead.clinic_name,
            lead_id: lead.id,
            lead_location: lead.location
          });
        });
      } catch (e) {
        // Skip if error
        console.warn(`Failed to get activities for lead ${lead.id}:`, e.message);
      }
    }

    // Sort by date (newest first) and limit
    const sorted = allActivities.sort((a, b) => {
      const dateA = new Date(a.activity_date || a.created_at || 0);
      const dateB = new Date(b.activity_date || b.created_at || 0);
      return dateB - dateA;
    }).slice(0, parseInt(limit, 10));

    res.json({
      success: true,
      activities: sorted,
      total: sorted.length
    });
  } catch (error) {
    console.error('❌ Get all activities error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get activities',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/:id/activities
 * Get all activities for a lead
 */
router.get('/:id/activities', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, limit } = req.query;

    const filters = {};
    if (type) filters.activity_type = type;
    if (limit) filters.limit = parseInt(limit, 10);

    const activities = db.getLeadActivities(id, filters);

    res.json({
      success: true,
      activities,
      total: activities.length
    });
  } catch (error) {
    console.error('❌ Get activities error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get activities',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/:id/activities
 * Create a new activity for a lead
 */
router.post('/:id/activities', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { activity_type, activity_subject, activity_description, activity_date, metadata } = req.body;

    if (!activity_type) {
      return res.status(400).json({
        success: false,
        error: 'activity_type is required'
      });
    }

    const activity = db.createLeadActivity({
      lead_id: id,
      activity_type,
      activity_subject,
      activity_description,
      activity_date,
      created_by: req.user?.id || 'admin',
      metadata
    });

    res.json({
      success: true,
      message: 'Activity created successfully',
      activity
    });
  } catch (error) {
    console.error('❌ Create activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create activity',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/qualified
 * Get all qualified leads (has phone + email + is clinic)
 */
router.get('/qualified', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { pipeline_stage, needs_followup, limit } = req.query;

    const filters = {};
    if (pipeline_stage) filters.pipeline_stage = pipeline_stage;
    if (needs_followup === 'true') filters.needs_followup = true;
    if (limit) filters.limit = parseInt(limit, 10);

    const leads = db.getAllQualifiedLeads(filters);

    const leadsWithCalls = leads.map(lead => {
      const calls = db.getLeadCallsByLeadId(lead.id);
      return {
        ...lead,
        call_count: calls.length,
        last_call_at: calls.length > 0 ? calls[0].created_at : null
      };
    });

    res.json({
      success: true,
      leads: leadsWithCalls,
      total: leadsWithCalls.length
    });
  } catch (error) {
    console.error('❌ Get qualified leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get qualified leads',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/:id
 * Get a specific lead with its calls
 */
router.get('/:id', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = db.getLead(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    const calls = db.getLeadCallsByLeadId(id);

    res.json({
      success: true,
      lead: {
        ...lead,
        calls
      }
    });
  } catch (error) {
    console.error('❌ Get lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get lead',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/insights/medical-receptionist
 * Fetch one or more Medical Receptionist leads (credit-aware search)
 * - Uses Google Jobs engine via SerpAPI
 * - Filters for titles containing \"Medical\" and \"Receptionist\"
 * - Returns top N leads (default 3)
 */
// Keywords that indicate a clinic needs our AI billing/insurance product
const PRODUCT_KEYWORDS = [
  'billing', 'insurance', 'medical billing', 'insurance verification', 'claims',
  'emr', 'ehr', 'electronic medical records', 'electronic health records',
  'medical records', 'patient records', 'cpt codes', 'icd codes', 'coding',
  'prior authorization', 'pre-authorization', 'eligibility', 'benefits verification',
  'claim submission', 'claim processing', 'denials', 'appeals', 'revenue cycle',
  'ar', 'accounts receivable', 'collections', 'payment posting', 'charge capture'
];

/**
 * Analyze job description to determine if clinic needs our AI product
 * Returns true if description contains keywords related to billing/insurance/records
 */
function qualifiesFromDescription(description) {
  if (!description) return false;
  const descLower = description.toLowerCase();
  return PRODUCT_KEYWORDS.some(keyword => descLower.includes(keyword.toLowerCase()));
}

router.get('/insights/medical-receptionist', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    // Get search parameters
    const query = req.query.query || 'Medical receptionist OR dental receptionist OR healthcare receptionist';
    const locationParam = req.query.location || 'US'; // Default to all US
    const days = req.query.days ? parseInt(req.query.days, 10) : 1; // Default to TODAY
    const maxLeads = parseInt(process.env.MEDICAL_RECEPTIONIST_MAX_LEADS || '100', 10); // Increased for nationwide
    const autoSave = req.query.auto_save === 'true'; // Auto-save all leads

    // Parse location - can be "US" (all states), "US,NY" (single state), or "US,NY,US,NJ" (multiple states)
    let locations = [];
    if (locationParam === 'US' || locationParam === 'all' || locationParam === '') {
      // Search all US - just use "US" without state
      locations = ['US'];
    } else {
      // Parse comma-separated states: "US,NY,US,NJ" or "US,NY"
      const parts = locationParam.split(',').map(p => p.trim());
      if (parts[0].toUpperCase() === 'US' && parts.length > 1) {
        // Multiple states: "US,NY,US,NJ" -> ["US,NY", "US,NJ"]
        for (let i = 1; i < parts.length; i++) {
          if (parts[i].toUpperCase() === 'US' && parts[i + 1]) {
            locations.push(`US,${parts[i + 1]}`);
            i++; // Skip next
          } else if (parts[i].length === 2) {
            locations.push(`US,${parts[i]}`);
          }
        }
        // If only one state: "US,NY" -> ["US,NY"]
        if (locations.length === 0 && parts.length === 2) {
          locations = [`US,${parts[1]}`];
        }
      } else {
        locations = [locationParam];
      }
    }

    console.log(`🔍 Searching ${locations.length} location(s): ${locations.join(', ')}`);
    console.log(`📅 Days: ${days} (${days === 1 ? 'TODAY' : `Last ${days} days`})`);
    console.log(`🔎 Query: ${query}`);

    // Search for healthcare receptionist jobs (medical, dental, specialty practices)
    // These facilities typically handle insurance billing, making them ideal for our software
    let allSearchResults = [];
    for (const location of locations) {
      try {
        const searchResults = await searchJobs({
          query,
          location,
          postedSinceDays: days,
          engine: 'jsearch' // Use JSearch for richer job feed
        });
        if (searchResults && searchResults.length > 0) {
          allSearchResults = allSearchResults.concat(searchResults);
          console.log(`✅ Found ${searchResults.length} jobs in ${location}`);
        }
      } catch (locationError) {
        console.warn(`⚠️  Search failed for ${location}:`, locationError.message);
        // Continue with other locations
      }
    }

    if (!allSearchResults || allSearchResults.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No medical receptionist leads found for NY or NJ'
      });
    }

    console.log(`📊 JSearch returned ${allSearchResults.length} results from NY and NJ, maxLeads=${maxLeads}`);

    // Filter for titles that look like medical receptionist roles
    // Less strict: just needs "receptionist" (we're already searching for "Medical receptionist")
    const filtered = allSearchResults.filter(job => {
      const title = (job.title || '').toLowerCase();
      const clinicName = (job.clinic_name || '').toLowerCase();
      // Accept if title has "receptionist" OR clinic name suggests medical/healthcare
      return title.includes('receptionist') ||
        clinicName.includes('health') ||
        clinicName.includes('medical') ||
        clinicName.includes('clinic') ||
        clinicName.includes('care');
    });

    console.log(`🔍 Filtered to ${filtered.length} relevant leads`);

    // Take up to maxLeads, prioritizing filtered results but falling back to all if needed
    const candidates = filtered.length >= maxLeads
      ? filtered.slice(0, maxLeads)
      : [...filtered, ...allSearchResults.filter(j => !filtered.includes(j))].slice(0, maxLeads);

    console.log(`✅ Returning ${candidates.length} candidates for processing`);

    const leads = [];
    for (const job of candidates) {
      const description = job.description || job.snippet || job.job_description || null;

      const enriched = await leadIngestion.enrichJobCandidate(job);
      if (!leadIngestion.isCallableLead(enriched)) {
        continue;
      }

      let clinic_phone = enriched.clinic_phone;
      let clinic_email = enriched.clinic_email;
      let opening_hours = enriched.opening_hours;

      // Check if job description qualifies them for our AI product
      const qualifiesFromDesc = qualifiesFromDescription(description);
      if (qualifiesFromDesc) {
        console.log(`✅ Lead qualifies from description: ${job.clinic_name || job.title}`);
      }

      const salary = job.salary || job.pay_rate || job.pay_range || job.compensation || null;

      // Detect specialty from job description (prioritize description over clinic name)
      function detectSpecialtyFromDescription(desc) {
        if (!desc || desc.trim().length < 10) return null; // Need meaningful description

        const descLower = desc.toLowerCase();

        // Dental specialties (check first - most specific)
        if (descLower.match(/\b(dental|dentist|orthodont|oral surgery|periodont|endodont|prosthodont)\b/)) {
          return 'Dental';
        }

        // Therapy/Mental Health (check early - specific)
        if (descLower.match(/\b(therapist|therapy|mental health|counseling|counselor|psychotherapy|psychologist|psychiatric|behavioral health|substance abuse|addiction treatment)\b/)) {
          return 'Therapy';
        }

        // Physical Therapy
        if (descLower.match(/\b(physical therapy|physiotherapy|pt|physical therapist|rehabilitation|rehab)\b/)) {
          return 'Physical Therapy';
        }

        // Occupational Therapy
        if (descLower.match(/\b(occupational therapy|ot|occupational therapist)\b/)) {
          return 'Occupational Therapy';
        }

        // Speech Therapy
        if (descLower.match(/\b(speech therapy|speech therapist|slp|speech language)\b/)) {
          return 'Speech Therapy';
        }

        // Cardiology
        if (descLower.match(/\b(cardiology|cardiac|cardiologist|heart|cardiac care)\b/)) {
          return 'Cardiology';
        }

        // Dermatology
        if (descLower.match(/\b(dermatology|dermatologist|skin|dermatologic)\b/)) {
          return 'Dermatology';
        }

        // Pediatrics
        if (descLower.match(/\b(pediatric|pediatrics|pediatrician|children|kids|child care)\b/)) {
          return 'Pediatrics';
        }

        // Orthopedics
        if (descLower.match(/\b(orthopedic|orthopedics|orthopedic surgeon|bone|joint|sports medicine)\b/)) {
          return 'Orthopedics';
        }

        // Urgent Care
        if (descLower.match(/\b(urgent care|urgentcare|walk-in|emergency care)\b/)) {
          return 'Urgent Care';
        }

        // Primary Care / Family Practice
        if (descLower.match(/\b(primary care|family practice|family medicine|general practice|internal medicine|family physician)\b/)) {
          return 'Primary Care';
        }

        // OB/GYN
        if (descLower.match(/\b(obgyn|ob\/gyn|obstetric|gynecology|gynecologist|women's health|maternity)\b/)) {
          return 'OB/GYN';
        }

        // Ophthalmology / Eye Care
        if (descLower.match(/\b(ophthalmology|ophthalmologist|eye care|optometry|optometrist|vision)\b/)) {
          return 'Eye Care';
        }

        // Chiropractic
        if (descLower.match(/\b(chiropractic|chiropractor|spinal|adjustment)\b/)) {
          return 'Chiropractic';
        }

        // Podiatry
        if (descLower.match(/\b(podiatry|podiatrist|foot|ankle)\b/)) {
          return 'Podiatry';
        }

        // Neurology
        if (descLower.match(/\b(neurology|neurologist|neurological|brain|nervous system)\b/)) {
          return 'Neurology';
        }

        // Oncology
        if (descLower.match(/\b(oncology|oncologist|cancer|oncology care)\b/)) {
          return 'Oncology';
        }

        // If description mentions medical/clinic/healthcare but no specific specialty
        if (descLower.match(/\b(medical|clinic|healthcare|health care|medical practice|health center)\b/)) {
          return 'Medical';
        }

        return null; // Don't guess if we can't determine
      }

      // Detect specialty from company name first (most reliable indicator)
      function detectSpecialtyFromName(clinicName) {
        if (!clinicName) return null;
        const nameLower = clinicName.toLowerCase();

        // Wellness centers (check first - specific)
        if (nameLower.includes('wellness') || nameLower.includes('wellbeing')) {
          return 'Wellness';
        }

        // Dental (check for dental, dentist, dentistry, DMD, DDS)
        if (nameLower.includes('dental') || nameLower.includes('dentist') || nameLower.includes('dentistry') ||
          nameLower.includes(' dmd') || nameLower.includes(' dds') || nameLower.match(/\bdmd\b/) || nameLower.match(/\bdds\b/)) {
          return 'Dental';
        }

        // Physical Therapy (check before general therapy)
        if (nameLower.includes('physical therapy') || nameLower.includes('physiotherapy') || nameLower.includes('sportscare')) {
          return 'Physical Therapy';
        }

        // Occupational Therapy
        if (nameLower.includes('occupational therapy')) {
          return 'Occupational Therapy';
        }

        // Speech Therapy
        if (nameLower.includes('speech therapy') || nameLower.includes('speech language')) {
          return 'Speech Therapy';
        }

        // Urgent Care
        if (nameLower.includes('urgent care') || nameLower.includes('urgentcare') || nameLower.includes('wellnow')) {
          return 'Urgent Care';
        }

        // Therapy/Mental Health (general - check after specific therapies)
        if (nameLower.includes('therapy') || nameLower.includes('therapist') || nameLower.includes('counseling')) {
          return 'Therapy';
        }

        // Other specialties from name
        if (nameLower.includes('cardiology') || nameLower.includes('cardiac')) {
          return 'Cardiology';
        }
        if (nameLower.includes('dermatology') || nameLower.includes('dermatologist')) {
          return 'Dermatology';
        }
        if (nameLower.includes('pediatric') || nameLower.includes('pediatrics')) {
          return 'Pediatrics';
        }
        if (nameLower.includes('orthopedic') || nameLower.includes('orthopedics')) {
          return 'Orthopedics';
        }
        if (nameLower.includes('primary care') || nameLower.includes('family practice')) {
          return 'Primary Care';
        }
        if (nameLower.includes('allergy') || nameLower.includes('asthma') || nameLower.includes('sinus')) {
          return 'Allergy & Immunology';
        }
        if (nameLower.includes('healogics') || nameLower.includes('wound care')) {
          return 'Wound Care';
        }

        return null;
      }

      // Try company name first, then description
      let specialty = detectSpecialtyFromName(job.clinic_name || job.company || job.source);

      // Fallback to description if name didn't yield results
      if (!specialty) {
        specialty = detectSpecialtyFromDescription(description);
      }

      // Final fallback - don't set "General", leave as null
      if (!specialty) {
        specialty = null;
      }

      const lang = extractLanguagesFromJob({ title: job.title, description });

      leads.push({
        id: job.id || job.external_id || job.job_id || job.source_url,
        external_id: job.external_id || job.job_id || job.id || job.source_url,
        title: job.title || 'Medical Receptionist',
        clinic_name: job.clinic_name || job.company || job.source || 'Unknown Clinic',
        clinic_phone,
        clinic_email,
        opening_hours,
        location: job.location || job.city || job.job_location || 'NY or NJ',
        posted_at: job.posted_at || job.date || null,
        description,
        salary, // Include salary in lead data
        specialty, // Include specialty
        source_url: enriched.source_url,
        notes: leadIngestion.buildNotesWithJobPosting(enriched.job_posting_url, null),
        required_languages: lang.required_languages.length
          ? JSON.stringify(lang.required_languages)
          : null,
        preferred_language: lang.preferred_language,
        qualifies_from_description: qualifiesFromDesc // Flag for frontend
      });
    }

    // Auto-save all leads if requested
    const savedLeads = [];
    if (autoSave) {
      console.log(`💾 Auto-saving ${leads.length} leads...`);
      for (const leadData of leads) {
        try {
          // Check if lead already exists by external_id (most reliable)
          let existing = null;
          if (leadData.external_id) {
            existing = db.getLeadByExternalId(leadData.external_id);
          }

          // Fallback: check by clinic name + location if no external_id
          if (!existing && leadData.clinic_name) {
            const allLeads = db.getAllLeads({ clinic_name: leadData.clinic_name, limit: 100 });
            existing = allLeads.find(l =>
              l.clinic_name === leadData.clinic_name &&
              l.location === leadData.location
            );
          }

          if (!existing) {
            const saved = db.createLead(leadData);
            savedLeads.push(saved);
            console.log(`✅ Saved: ${leadData.clinic_name}`);
          } else {
            console.log(`⏭️  Skipped duplicate: ${leadData.clinic_name}`);
          }
        } catch (saveError) {
          // If it's a UNIQUE constraint error, it's a duplicate - skip it
          if (saveError.message && saveError.message.includes('UNIQUE constraint')) {
            console.log(`⏭️  Skipped duplicate (external_id): ${leadData.clinic_name}`);
          } else {
            console.error(`❌ Failed to save ${leadData.clinic_name}:`, saveError.message);
          }
        }
      }
      console.log(`✅ Auto-saved ${savedLeads.length} new leads`);
    }

    const primaryLead = leads[0];

    res.json({
      success: true,
      query: query,
      location: locationParam === 'US' || locationParam === 'all' ? 'All US States' : locationParam,
      days: days,
      lead: primaryLead,
      leads,
      saved_count: savedLeads.length,
      total_found: allSearchResults.length,
      credits_used: 1
    });
  } catch (error) {
    console.error('❌ Medical receptionist insight error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch medical receptionist insight',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/:id/extract-contact
 * Extract phone/email from lead's source_url
 */
router.post('/:id/extract-contact', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = db.getLead(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    if (!lead.source_url) {
      return res.status(400).json({
        success: false,
        error: 'Lead has no source_url to extract from'
      });
    }

    console.log(`🔍 Extracting contact info from: ${lead.source_url}`);

    // Extract contact info
    const { phone, email, openingHours, error: extractError } = await extractContactInfo(
      lead.source_url,
      lead.clinic_name,
      lead.location
    );

    if (extractError) {
      console.warn('⚠️  Contact extraction warning:', extractError);
    }

    // Update lead with extracted info (only if we found something)
    const updates = {};
    if (phone && !lead.clinic_phone) {
      updates.clinic_phone = phone;
    }
    if (email && !lead.clinic_email) {
      updates.clinic_email = email;
    }
    if (openingHours && !lead.opening_hours) {
      updates.opening_hours = openingHours;
    }

    if (Object.keys(updates).length > 0) {
      db.updateLead(id, updates);
      const updatedLead = db.getLead(id);

      res.json({
        success: true,
        message: 'Contact info extracted successfully',
        extracted: { phone, email },
        lead: updatedLead
      });
    } else {
      res.json({
        success: true,
        message: 'No contact info found on page',
        extracted: { phone, email },
        lead
      });
    }
  } catch (error) {
    console.error('❌ Extract contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract contact info',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/extract-contacts-batch
 * Extract contact info for multiple leads (batch processing)
 */
router.post('/extract-contacts-batch', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { lead_ids } = req.body;

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'lead_ids array is required'
      });
    }

    const results = [];

    for (const leadId of lead_ids) {
      const lead = db.getLead(leadId);
      if (!lead || !lead.source_url) {
        results.push({
          lead_id: leadId,
          success: false,
          error: 'Lead not found or no source_url'
        });
        continue;
      }

      try {
        const { phone, email, openingHours } = await extractContactInfo(
          lead.source_url,
          lead.clinic_name,
          lead.location
        );

        const updates = {};
        if (phone && !lead.clinic_phone) updates.clinic_phone = phone;
        if (email && !lead.clinic_email) updates.clinic_email = email;
        if (openingHours && !lead.opening_hours) updates.opening_hours = openingHours;

        if (Object.keys(updates).length > 0) {
          db.updateLead(leadId, updates);
        }

        results.push({
          lead_id: leadId,
          success: true,
          extracted: { phone, email }
        });

        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({
          lead_id: leadId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      results,
      total: results.length,
      successful: results.filter(r => r.success).length
    });
  } catch (error) {
    console.error('❌ Batch extract contacts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract contacts',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/:id/calls
 * Get all calls for a specific lead
 */
router.get('/:id/calls', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const calls = db.getLeadCallsByLeadId(id);

    res.json({
      success: true,
      calls,
      total: calls.length
    });
  } catch (error) {
    console.error('❌ Get lead calls error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get calls',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/configure-sales-agent
 * Configure/update the Retell sales agent with the sales prompt
 */
router.post('/configure-sales-agent', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const salesAgentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;

    if (!salesAgentId) {
      return res.status(400).json({
        success: false,
        error: 'RETELL_SALES_AGENT_ID not configured. Please set in .env file.'
      });
    }

    // Load sales prompt
    const salesPrompt = retellService.loadSalesPrompt();
    const salesFunctions = retellService.loadSalesAgentFunctions();

    // Update the agent with sales prompt and functions
    const updateResult = await retellService.updateAgent(salesAgentId, {
      system_prompt: salesPrompt,
      agent_name: 'Somo Sales Agent - Alex',
      functions: salesFunctions
    });

    if (updateResult.success) {
      res.json({
        success: true,
        message: 'Sales agent configured successfully',
        agent_id: salesAgentId,
        agent_data: updateResult.agent_data
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to configure sales agent',
        message: updateResult.error
      });
    }
  } catch (error) {
    console.error('❌ Configure sales agent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to configure sales agent',
      message: error.message
    });
  }
});

/**
 * PUT /api/admin/leads/:id
 * Update a lead (e.g., add phone/email, set priority, status)
 */
router.put('/:id', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    db.updateLead(id, updates);
    const updatedLead = db.getLead(id);

    res.json({
      success: true,
      message: 'Lead updated successfully',
      lead: updatedLead
    });
  } catch (error) {
    console.error('❌ Update lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update lead',
      message: error.message
    });
  }
});

/**
 * DELETE /api/admin/leads/:id
 * Delete a specific lead and all related records (calls, activities)
 */
router.delete('/:id', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = db.getLead(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    db.deleteLead(id);

    res.json({
      success: true,
      message: 'Lead deleted successfully',
      deleted_lead_id: id
    });
  } catch (error) {
    console.error('❌ Delete lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete lead',
      message: error.message
    });
  }
});

/**
 * DELETE /api/admin/leads/test/bulk
 * Bulk delete all test leads (identified by is_test=1, test clinic names, test emails)
 */
router.delete('/test/bulk', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const result = db.deleteTestLeads();

    res.json({
      success: true,
      message: `Deleted ${result.leads} test leads and related records`,
      deleted: {
        leads: result.leads,
        calls: result.calls,
        activities: result.activities
      }
    });
  } catch (error) {
    console.error('❌ Bulk delete test leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete test leads',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/:id/send-email
 * Send an email to a lead
 * Supports templates and custom content
 */
router.post('/:id/send-email', requireAdminOrCapability('platform.leads'), adminLimiter, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, content, template_id, schedule_date } = req.body;

    const lead = db.getLead(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    if (!lead.clinic_email) {
      return res.status(400).json({
        success: false,
        error: 'Lead does not have an email address'
      });
    }

    // If template_id is provided, load template
    let emailSubject = subject;
    let emailContent = content;

    if (template_id) {
      const template = db.getTemplate(template_id);
      if (!template || template.type !== 'email') {
        return res.status(400).json({
          success: false,
          error: 'Template not found or not an email template'
        });
      }

      emailSubject = template.subject || emailSubject;
      emailContent = template.content || emailContent;

      // Replace template variables
      emailSubject = replaceTemplateVariables(emailSubject, lead);
      emailContent = replaceTemplateVariables(emailContent, lead);
    } else {
      // Replace variables in custom content
      if (emailSubject) emailSubject = replaceTemplateVariables(emailSubject, lead);
      if (emailContent) emailContent = replaceTemplateVariables(emailContent, lead);
    }

    if (!emailSubject || !emailContent) {
      return res.status(400).json({
        success: false,
        error: 'Email subject and content are required'
      });
    }

    // If schedule_date is provided, create scheduled activity instead of sending immediately
    if (schedule_date) {
      const { v4: uuidv4 } = require('uuid');
      const activityId = uuidv4();

      db.createLeadActivity({
        id: activityId,
        lead_id: id,
        activity_type: 'email',
        activity_subject: emailSubject,
        activity_description: `Scheduled email: ${emailSubject}`,
        activity_date: schedule_date,
        created_by: req.user?.id || 'admin',
        metadata: JSON.stringify({
          status: 'scheduled',
          scheduled_date: schedule_date,
          subject: emailSubject,
          content: emailContent,
          template_id: template_id || null
        })
      });

      // Update lead follow_up_date if not set or if scheduled date is earlier
      if (!lead.follow_up_date || new Date(schedule_date) < new Date(lead.follow_up_date)) {
        db.updateLead(id, {
          follow_up_date: schedule_date,
          next_action: `Send email: ${emailSubject}`
        });
      }

      return res.json({
        success: true,
        message: 'Email scheduled successfully',
        scheduled_date: schedule_date,
        activity_id: activityId
      });
    }

    // Send email immediately
    const EmailService = require('../services/email-service');
    const emailResult = await EmailService.sendEmail({
      to: lead.clinic_email,
      subject: emailSubject,
      html: emailContent,
      text: emailContent.replace(/<[^>]*>/g, '') // Strip HTML for text version
    });

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send email',
        message: emailResult.error || 'Email service error'
      });
    }

    // Create activity record
    const { v4: uuidv4 } = require('uuid');
    db.createLeadActivity({
      id: uuidv4(),
      lead_id: id,
      activity_type: 'email',
      activity_subject: emailSubject,
      activity_description: `Email sent to ${lead.clinic_email}`,
      created_by: req.user?.id || 'admin',
      metadata: JSON.stringify({
        email_provider: emailResult.provider,
        message_id: emailResult.message_id,
        template_id: template_id || null
      })
    });

    // Update lead status
    if (lead.status === 'new') {
      db.updateLead(id, {
        status: 'contacted',
        pipeline_stage: lead.pipeline_stage === 'new' ? 'contacted' : lead.pipeline_stage
      });
    }

    res.json({
      success: true,
      message: 'Email sent successfully',
      email_result: {
        provider: emailResult.provider,
        message_id: emailResult.message_id
      }
    });
  } catch (error) {
    console.error('❌ Send email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/leads/templates
 * Get email templates for admin leads (global templates without merchant requirement)
 */
router.get('/templates', requireAdminOrCapability('platform.leads'), adminLimiter, (req, res) => {
  try {
    const { type } = req.query;

    // Get templates for admin (merchant_id = 'admin-global' or NULL)
    const templates = db.db.prepare(`
      SELECT * FROM templates 
      WHERE type = ? AND (merchant_id = 'admin-global' OR merchant_id IS NULL)
      ORDER BY created_at DESC
    `).all(type || 'email');

    // Parse variables JSON
    const parsedTemplates = templates.map(t => ({
      ...t,
      variables: t.variables ? JSON.parse(t.variables) : []
    }));

    res.json({
      success: true,
      templates: parsedTemplates
    });
  } catch (error) {
    console.error('Get admin templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get templates',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/templates
 * Create a template for admin leads
 */
router.post('/templates', requireAdminOrCapability('platform.leads'), adminLimiter, express.json(), (req, res) => {
  try {
    const { name, type, subject, content, variables } = req.body;

    if (!name || !type || !content) {
      return res.status(400).json({
        success: false,
        error: 'Name, type, and content are required'
      });
    }

    if (!['email', 'sms'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Type must be "email" or "sms"'
      });
    }

    // Use null merchant_id for admin templates, or a special admin merchant_id
    // For now, we'll require a merchant_id but allow admin to specify
    // Actually, let's check if we can create templates without merchant_id
    // Since the table requires merchant_id, we'll need to handle this
    // For now, let's use a special admin merchant_id or modify the schema
    // For simplicity, let's just allow merchant_id to be optional in the query

    const { v4: uuidv4 } = require('uuid');
    const templateId = uuidv4();

    // Use a special admin merchant_id 'admin-global' or NULL if schema allows
    try {
      db.db.prepare(`
        INSERT INTO templates (id, merchant_id, name, type, subject, content, variables)
        VALUES (?, 'admin-global', ?, ?, ?, ?, ?)
      `).run(
        templateId,
        name,
        type,
        subject || null,
        content,
        variables ? JSON.stringify(variables) : null
      );
    } catch (schemaError) {
      // If that fails, try with NULL
      try {
        db.db.prepare(`
          INSERT INTO templates (id, merchant_id, name, type, subject, content, variables)
          VALUES (?, NULL, ?, ?, ?, ?, ?)
        `).run(
          templateId,
          name,
          type,
          subject || null,
          content,
          variables ? JSON.stringify(variables) : null
        );
      } catch (nullError) {
        return res.status(400).json({
          success: false,
          error: 'Failed to create template. Database schema may require merchant_id.'
        });
      }
    }

    const template = db.getTemplate(templateId);

    res.json({
      success: true,
      template: {
        ...template,
        variables: template.variables ? JSON.parse(template.variables) : []
      }
    });
  } catch (error) {
    console.error('Create admin template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create template',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/:id/send-sms
 * Send an SMS to a lead
 */
router.post('/:id/send-sms', requireAdminOrCapability('platform.leads'), adminLimiter, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { message, schedule_date } = req.body;

    const lead = db.getLead(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    if (!lead.clinic_phone) {
      return res.status(400).json({
        success: false,
        error: 'Lead does not have a phone number'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    // Replace variables
    const smsMessage = replaceTemplateVariables(message, lead);

    // If schedule_date is provided, create scheduled activity
    if (schedule_date) {
      const { v4: uuidv4 } = require('uuid');
      const activityId = uuidv4();

      db.createLeadActivity({
        id: activityId,
        lead_id: id,
        activity_type: 'sms',
        activity_subject: 'Scheduled SMS',
        activity_description: smsMessage,
        activity_date: schedule_date,
        created_by: req.user?.id || 'admin',
        metadata: JSON.stringify({
          status: 'scheduled',
          scheduled_date: schedule_date,
          message: smsMessage
        })
      });

      if (!lead.follow_up_date || new Date(schedule_date) < new Date(lead.follow_up_date)) {
        db.updateLead(id, {
          follow_up_date: schedule_date,
          next_action: 'Send SMS'
        });
      }

      return res.json({
        success: true,
        message: 'SMS scheduled successfully',
        scheduled_date: schedule_date,
        activity_id: activityId
      });
    }

    // Send SMS immediately
    const SMSService = require('../services/sms-service');
    const smsResult = await SMSService.sendSMS(lead.clinic_phone, smsMessage);

    // Normalize response format
    const normalizedResult = {
      success: smsResult.success || false,
      provider: smsResult.provider || 'twilio',
      message_id: smsResult.message_sid || smsResult.message_id || null,
      error: smsResult.error || null
    };

    if (!normalizedResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send SMS',
        message: normalizedResult.error || 'SMS service error'
      });
    }

    // Create activity record
    const { v4: uuidv4 } = require('uuid');
    db.createLeadActivity({
      id: uuidv4(),
      lead_id: id,
      activity_type: 'sms',
      activity_subject: 'SMS sent',
      activity_description: smsMessage,
      created_by: req.user?.id || 'admin',
      metadata: JSON.stringify({
        provider: normalizedResult.provider,
        message_id: normalizedResult.message_id
      })
    });

    if (lead.status === 'new') {
      db.updateLead(id, {
        status: 'contacted',
        pipeline_stage: lead.pipeline_stage === 'new' ? 'contacted' : lead.pipeline_stage
      });
    }

    res.json({
      success: true,
      message: 'SMS sent successfully',
      sms_result: normalizedResult
    });
  } catch (error) {
    console.error('❌ Send SMS error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send SMS',
      message: error.message
    });
  }
});

/**
 * Helper function to replace template variables
 */
function replaceTemplateVariables(text, lead) {
  if (!text) return text;

  const variables = {
    '{{clinic_name}}': lead.clinic_name || 'Clinic',
    '{{location}}': lead.location || 'Location',
    '{{clinic_phone}}': lead.clinic_phone || 'Phone',
    '{{clinic_email}}': lead.clinic_email || 'Email',
    '{{pipeline_stage}}': lead.pipeline_stage || 'new',
    '{{lead_score}}': lead.lead_score || 0,
    '{{source}}': lead.source || 'unknown'
  };

  let result = text;
  Object.keys(variables).forEach(key => {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), variables[key]);
  });

  return result;
}

/**
 * POST /api/admin/leads/:id/recalculate-score
 * Recalculate lead score
 */
router.post('/:id/recalculate-score', requireAdminOrCapability('platform.leads'), adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const LeadIntelligenceService = require('../services/lead-intelligence-service');

    const score = LeadIntelligenceService.updateLeadScore(id);

    res.json({
      success: true,
      lead_id: id,
      score
    });
  } catch (error) {
    console.error('Recalculate lead score error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to recalculate score',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/:id/qualify
 * Qualify/unqualify lead
 */
router.post('/:id/qualify', requireAdminOrCapability('platform.leads'), adminLimiter, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { qualified = true } = req.body;

    const now = new Date().toISOString();
    db.updateLead(id, {
      is_qualified: qualified ? 1 : 0,
      qualified_at: qualified ? now : null,
      auto_qualified: 0 // Manual qualification, not auto
    });

    // Update score as well
    const LeadIntelligenceService = require('../services/lead-intelligence-service');
    LeadIntelligenceService.updateLeadScore(id);

    const lead = db.getLead(id);

    res.json({
      success: true,
      lead
    });
  } catch (error) {
    console.error('Qualify lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to qualify lead',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/leads/batch/update-scores
 * Batch update scores for multiple leads
 */
router.post('/batch/update-scores', requireAdminOrCapability('platform.leads'), adminLimiter, express.json(), async (req, res) => {
  try {
    const { lead_ids } = req.body; // Optional: if not provided, update all leads
    const LeadIntelligenceService = require('../services/lead-intelligence-service');

    const result = LeadIntelligenceService.batchUpdateScores(lead_ids);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Batch update scores error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to batch update scores',
      message: error.message
    });
  }
});

module.exports = router;



