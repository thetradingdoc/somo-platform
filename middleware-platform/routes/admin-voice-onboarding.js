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
const { resolveOnboardingBlockers } = require('../services/onboarding-blockers-service');
const {
  resolveCallOpeners,
  resolvePracticeDisplayName
} = require('../services/call-opener-resolver');
const { normalizeSettingsRow } = require('../services/voice-settings-sync');
const { resolveClinicForCustomer } = require('../services/tenant-voice-config');

function requireAdmin(req, res, next) {
  if (!hasValidSession(req)) {
    return res.status(401).json({ success: false, error: 'Admin authentication required' });
  }
  return next();
}

function resolveClinicIdForCustomer(dbModule, customerId) {
  const clinic = resolveClinicForCustomer(dbModule, customerId);
  return clinic?.clinic_id || null;
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
      destination: resolveOnboardingDestination(customer, db),
      settings,
      preview
    });
  } catch (e) {
    console.error('[admin-voice-onboarding] voice-onboarding GET failed:', e.message);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

router.post('/customers/:customerId/reset-onboarding', requireAdmin, (req, res) => {
  try {
    const customer = db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const target = req.body?.state || 'voice_setup_incomplete';
    transitionState(db, customer.id, target, { reset_by: 'admin', wizard_step: 1 }, { serverSide: true });
    const refreshed = db.getCustomer(customer.id);
    return res.json({
      success: true,
      onboarding_state: getOnboardingState(refreshed),
      destination: resolveOnboardingDestination(refreshed, db)
    });
  } catch (e) {
    console.error('[admin-voice-onboarding] reset-onboarding failed:', e.message);
    return res.status(500).json({ success: false, error: 'server_error' });
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
    console.error('[admin-voice-onboarding] opener-compare failed:', e.message);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

router.post('/customers/:customerId/go-live', requireAdmin, (req, res) => {
  try {
    const customer = db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const { blockers } = resolveOnboardingBlockers(db, customer);
    if (blockers.length) {
      return res.status(409).json({ success: false, error: 'blockers_pending', blockers });
    }
    const clinicId = resolveClinicIdForCustomer(db, customer.id);
    if (!clinicId) {
      return res.status(404).json({ success: false, error: 'clinic_not_found' });
    }
    const body = req.body || {};
    const patch = {};
    if (body.shadow_week_active === true || body.shadow_week_active === 1) {
      patch.shadow_week_active = 1;
      patch.shadow_week_ends_at = body.shadow_week_ends_at
        || new Date(Date.now() + 7 * 86400000).toISOString();
    }
    if (body.pilot_live_at) {
      patch.pilot_live_at = body.pilot_live_at;
    } else if (body.activate_live === true) {
      patch.pilot_live_at = new Date().toISOString();
    }
    if (Object.keys(patch).length) {
      db.updateClinic(clinicId, patch);
    }
    console.log(JSON.stringify({
      event: 'admin_go_live',
      admin: req.adminSession?.email || 'admin',
      customer_id: customer.id,
      clinic_id: clinicId,
      patch
    }));
    const clinic = db.getClinicById(clinicId);
    return res.json({ success: true, clinic });
  } catch (e) {
    console.error('[admin-voice-onboarding] go-live failed:', e.message);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

router.get('/stuck', requireAdmin, (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const staleStates = ['voice_setup_incomplete', 'activation_shown', 'terms_accepted'];
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    if (!db.db) {
      return res.json({ success: true, customers: [], days, page, limit, total: 0 });
    }
    const placeholders = staleStates.map(() => '?').join(',');
    const countRow = db.db
      .prepare(
        `SELECT COUNT(*) AS c FROM customers
         WHERE customer_type = 'saas'
           AND onboarding_state IN (${placeholders})
           AND datetime(COALESCE(onboarding_state_updated_at, created_at)) < datetime(?)`
      )
      .get(...staleStates, cutoff);
    const total = Number(countRow?.c || 0);
    const rows = db.db
      .prepare(
        `SELECT id, company_name, email, onboarding_state, onboarding_state_updated_at, onboarding_meta_json
         FROM customers
         WHERE customer_type = 'saas'
           AND onboarding_state IN (${placeholders})
           AND datetime(COALESCE(onboarding_state_updated_at, created_at)) < datetime(?)
         ORDER BY onboarding_state_updated_at ASC
         LIMIT ? OFFSET ?`
      )
      .all(...staleStates, cutoff, limit, offset);

    console.log(JSON.stringify({
      event: 'admin_stuck_onboarding_list',
      admin: req.adminSession?.email || 'admin',
      page,
      limit,
      total
    }));

    const customers = rows.map((c) => {
      const destination = resolveOnboardingDestination(c, db);
      const { blockers } = resolveOnboardingBlockers(db, c);
      return {
        customer_id: c.id,
        practice_name: c.company_name,
        email: c.email,
        onboarding_state: c.onboarding_state,
        stuck_since: c.onboarding_state_updated_at,
        destination,
        blockers
      };
    });

    return res.json({ success: true, customers, days, page, limit, total });
  } catch (e) {
    console.error('[admin-voice-onboarding] stuck list failed:', e.message);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

module.exports = router;
