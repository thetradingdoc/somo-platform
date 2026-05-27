const express = require('express');
const router = express.Router();

const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const TwilioPhoneService = require('../services/twilio-phone-service');

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

router.patch('/toggle', requireCustomerAuth, async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const customer = db.getCustomer(req.customer.id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    const nextStatus = enabled ? 'active' : 'paused';
    const provisioning = normalizeProvisioningState(customer);

    db.updateCustomer(customer.id, {
      kelly_status: nextStatus,
      retell_agent_status: nextStatus,
      provisioning_state: provisioning
    });

    const fresh = db.getCustomer(customer.id);
    const payload = buildStatus(fresh);
    return res.json({ success: true, message: `Kelly ${enabled ? 'activated' : 'paused'}`, ...payload });
  } catch (error) {
    console.error('❌ Kelly toggle error:', error);
    return res.status(500).json({ success: false, error: 'Failed to toggle Kelly', message: error.message });
  }
});

module.exports = router;
