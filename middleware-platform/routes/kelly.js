const express = require('express');
const router = express.Router();

const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const TwilioPhoneService = require('../services/twilio-phone-service');
const { updateAgentLifecycleState } = require('../services/agent-lifecycle');
const { resolveClinicIdFromRequest } = require('../lib/resolve-clinic-id');
const { listActivityForClinic } = require('../services/kelly-activity-feed-service');

function normalizeLifecycle(customer) {
  const status = String(customer.kelly_status || customer.retell_agent_status || 'pending').toLowerCase();
  if (['active', 'paused', 'error', 'pending'].includes(status)) return status;
  return 'pending';
}

function normalizeProvisioningState(customer) {
  const state = String(customer.provisioning_state || '').toLowerCase();
  if (['requested', 'provisioning', 'ready', 'failed'].includes(state)) return state;
  if (customer.retell_agent_id && customer.twilio_phone_number) return 'ready';
  if (customer.retell_agent_id || customer.twilio_phone_number) return 'provisioning';
  return 'requested';
}

function buildStatus(customer) {
  const hasPhone = !!customer.twilio_phone_number;
  const hasAgent = !!customer.retell_agent_id;
  const twilio = new TwilioPhoneService();

  return {
    customer_id: customer.id,
    phone_number: customer.twilio_phone_number || null,
    agent_id: customer.retell_agent_id || null,
    status: normalizeLifecycle(customer),
    provisioning_state: normalizeProvisioningState(customer),
    checks: {
      twilio_configured: !!twilio.isAvailable?.(),
      retell_configured: !!process.env.RETELL_API_KEY,
      has_phone: hasPhone,
      has_agent: hasAgent
    }
  };
}

function parsePayload(row) {
  if (!row?.payload_json) return {};
  try {
    return typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
  } catch (_) {
    return {};
  }
}

router.get('/status', requireCustomerAuth, async (req, res) => {
  try {
    const customer = db.getCustomer(req.customer.id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    const payload = buildStatus(customer);
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error('❌ Kelly status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load Kelly status', message: error.message });
  }
});

router.get('/activity', requireCustomerAuth, async (req, res) => {
  try {
    const clinicId = resolveClinicIdFromRequest(req);
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    }
    const limit = req.query.limit;
    const since = req.query.since || null;
    const activity = listActivityForClinic(clinicId, { limit, since });
    return res.json({ success: true, activity, clinic_id: clinicId });
  } catch (error) {
    console.error('❌ Kelly activity error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load Kelly activity', message: error.message });
  }
});

/**
 * GET /api/kelly/calls/:sessionId — aggregated call forensics for provider portal.
 */
router.get('/calls/:sessionId', requireCustomerAuth, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'session_id is required' });
    }

    const events = db.listKellyCallEvents
      ? db.listKellyCallEvents({ session_id: sessionId, limit: 200 })
      : [];

    const tools = [];
    let bookingOutcome = null;
    let orchestration = [];

    for (const row of events) {
      const payload = parsePayload(row);
      if (row.event_type === 'tool_invoked' || row.event_type === 'tool_completed') {
        tools.push({
          at: row.created_at,
          type: row.event_type,
          tool: payload.tool_name || payload.tool || null,
          success: payload.success !== false
        });
      }
      if (row.event_type === 'booking_outcome') {
        bookingOutcome = { at: row.created_at, ...payload };
      }
      if (row.event_type === 'orchestration_trace') {
        orchestration.push({
          at: row.created_at,
          lane: payload.lane || payload.active_lane,
          step: payload.step,
          gate_matched: payload.gate_matched,
          gate_outcome: payload.gate_outcome
        });
      }
    }

    let appointment = null;
    if (db.db) {
      try {
        appointment = db.db
          .prepare(
            `SELECT id, status, appointment_date, appointment_time, patient_name, triage_session_id
             FROM appointments WHERE triage_session_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`
          )
          .get(sessionId);
      } catch (_) {}
    }

    return res.json({
      success: true,
      session_id: sessionId,
      event_count: events.length,
      events: events.map((e) => ({
        id: e.id,
        event_type: e.event_type,
        at: e.created_at,
        payload: parsePayload(e)
      })),
      tools,
      booking_outcome: bookingOutcome,
      orchestration_trace: orchestration,
      appointment
    });
  } catch (error) {
    console.error('❌ Kelly call detail error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load call detail', message: error.message });
  }
});

router.patch('/toggle', requireCustomerAuth, async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const customer = db.getCustomer(req.customer.id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    const nextStatus = enabled ? 'active' : 'paused';
    const provisioning = normalizeProvisioningState(customer);

    updateAgentLifecycleState(customer.id, {
      kelly: nextStatus,
      retell: nextStatus,
      enabled
    });
    db.updateCustomer(customer.id, { provisioning_state: provisioning });

    if (customer.merchant_id || customer.id) {
      try {
        const existing = db.getVoiceAgentSettingsForProvider({
          merchantId: customer.merchant_id,
          customerId: customer.id
        });
        let businessHours = null;
        if (existing?.business_hours) {
          try {
            businessHours =
              typeof existing.business_hours === 'string'
                ? JSON.parse(existing.business_hours)
                : existing.business_hours;
          } catch (_) {
            businessHours = null;
          }
        }
        db.upsertVoiceAgentSettings(customer.merchant_id || null, {
          retell_agent_id: existing?.retell_agent_id || customer.retell_agent_id || null,
          enabled,
          greeting: existing?.greeting || null,
          after_hours_message: existing?.after_hours_message || null,
          business_hours: businessHours
        }, customer.id);
      } catch (syncErr) {
        console.warn('[Kelly] voice_agent_settings sync:', syncErr.message);
      }
    }

    const fresh = db.getCustomer(customer.id);
    const payload = buildStatus(fresh);
    return res.json({ success: true, message: `Kelly ${enabled ? 'activated' : 'paused'}`, ...payload });
  } catch (error) {
    console.error('❌ Kelly toggle error:', error);
    return res.status(500).json({ success: false, error: 'Failed to toggle Kelly', message: error.message });
  }
});

module.exports = router;
