'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { hasValidSession } = require('../middleware/admin-auth');
const {
  getOnboardingState,
  transitionState,
  resolveOnboardingDestination
} = require('../services/voice-onboarding-state');
const {
  resolveCallOpeners,
  resolvePracticeDisplayName
} = require('../services/call-opener-resolver');
const { normalizeSettingsRow } = require('../services/voice-settings-sync');

function requireAdmin(req, res, next) {
  if (!hasValidSession(req)) {
    return res.status(401).json({ success: false, error: 'Admin authentication required' });
  }
  return next();
}

router.get('/customers/:customerId/voice-onboarding', requireAdmin, (req, res) => {
  try {
    const customer = db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const settings = normalizeSettingsRow(
      db.getVoiceAgentSettingsForProvider({
        merchantId: customer.merchant_id,
        customerId: customer.id
      })
    );
    const practiceName = resolvePracticeDisplayName(db, { customer });
    const preview = resolveCallOpeners({ settings: settings || {}, customer, practiceName });
    return res.json({
      success: true,
      customer_id: customer.id,
      onboarding_state: getOnboardingState(customer),
      destination: resolveOnboardingDestination(customer),
      settings,
      preview
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/customers/:customerId/reset-onboarding', requireAdmin, (req, res) => {
  try {
    const customer = db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const target = req.body?.state || 'voice_setup_incomplete';
    transitionState(db, customer.id, target, { reset_by: 'admin', wizard_step: 1 });
    const refreshed = db.getCustomer(customer.id);
    return res.json({
      success: true,
      onboarding_state: getOnboardingState(refreshed),
      destination: resolveOnboardingDestination(refreshed)
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/customers/:customerId/opener-compare', requireAdmin, (req, res) => {
  try {
    const customer = db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const settings = normalizeSettingsRow(
      db.getVoiceAgentSettingsForProvider({
        merchantId: customer.merchant_id,
        customerId: customer.id
      })
    );
    let lastEvent = null;
    if (db.db) {
      lastEvent = db.db.prepare(`
        SELECT payload_json, created_at FROM kelly_call_events
        WHERE event_type = 'call_opener_used'
        AND json_extract(payload_json, '$.customer_id') = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(customer.id);
    }
    let live = null;
    if (lastEvent?.payload_json) {
      try {
        live = JSON.parse(lastEvent.payload_json);
      } catch (_) {}
    }
    return res.json({
      success: true,
      saved: {
        inbound: settings?.greeting || null,
        outbound: settings?.outbound_opener || null
      },
      last_live: live,
      last_live_at: lastEvent?.created_at || null,
      match:
        live?.opener_text && settings?.greeting
          ? String(live.opener_text).trim() === String(settings.greeting).trim()
          : null
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
