/**
 * Customer account routes — extracted from routes/signup.js
 */
'use strict';

const express = require('express');
const router = express.Router();
const shared = require('./lib/signup-shared');
const {
  express: _express,
  crypto,
  db,
  EmailService,
  ProviderService,
  RetellService,
  TwilioPhoneService,
  uuidv4,
  rateLimiter,
  lenientAuthLimiter,
  generateSimplePassword,
  requireCustomerAuth,
  ensureClaimSessionTables,
  claimLandingSessionToCustomer,
  listCustomerProducts,
  bcrypt,
  stripe,
  SAAS_PORTAL_HOME,
  getSessionCookieOptions
} = shared;


router.post('/customers/me/api-keys', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please sign up and accept terms first'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'Please accept the terms of service first'
      });
    }

    // Generate API key
    const { generateApiKey, hashApiKey, encryptApiKey } = require('../utils/api-keys');
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyPrefix = apiKey.substring(0, 12); // First 12 chars for display
    const encryptedKey = encryptApiKey(apiKey); // Encrypt for admin recovery

    const apiKeyId = `key_${uuidv4()}`;
    db.createAPIKey({
      id: apiKeyId,
      customer_id: customer.id,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      key_secret: encryptedKey, // Store encrypted full key for admin recovery
      rate_limit_tier: 'starter',
      is_active: true
    });

    // Return API key (only time it's shown in full)
    res.json({
      success: true,
      api_key: apiKey,
      key_prefix: keyPrefix,
      key_id: apiKeyId,
      message: 'API key created successfully. Save this key securely - it will not be shown again.',
      warning: 'This is the only time you will see your full API key. Store it securely.'
    });
  } catch (error) {
    console.error('❌ Create API key error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create API key',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/me/api-keys
 * List customer's API keys (masked)
 */
router.get('/customers/me/api-keys', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing API keys. Please visit /terms to accept.'
      });
    }

    const keys = db.getCustomerAPIKeys(session.customer_id);
    res.json({
      success: true,
      api_keys: keys.map(key => ({
        id: key.id,
        key_prefix: key.key_prefix,
        created_at: key.created_at,
        last_used_at: key.last_used_at,
        is_active: key.is_active === 1
      }))
    });
  } catch (error) {
    console.error('❌ Get API keys error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve API keys',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/me/availability-status
 * Get current provider's online/offline status (session-based)
 */
router.get('/customers/me/availability-status', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const status = ProviderService.getProviderStatus(customer.email);
    res.json({
      success: true,
      status: status || { is_online: false, availability_rules: null, updated_at: null }
    });
  } catch (error) {
    console.error('❌ Get availability status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/customers/me/availability-blocks
 * List availability blocks for the session provider
 */
router.get('/customers/me/availability-blocks', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const startDate = req.query.start;
    const endDate = req.query.end;
    const blocks = ProviderService.getAvailabilityBlocks(customer.email, startDate || undefined, endDate || undefined);
    res.json({ success: true, blocks });
  } catch (error) {
    console.error('❌ Get availability blocks error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customers/me/availability-blocks
 * Create availability block (available or out_of_office)
 */
router.post('/customers/me/availability-blocks', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const { block_type, start_datetime, end_datetime, title } = req.body || {};
    if (!block_type || !['available', 'out_of_office'].includes(block_type)) {
      return res.status(400).json({ success: false, error: 'block_type must be "available" or "out_of_office"' });
    }
    if (!start_datetime || !end_datetime) {
      return res.status(400).json({ success: false, error: 'start_datetime and end_datetime required' });
    }
    const block = ProviderService.createAvailabilityBlock({
      provider_email: customer.email,
      block_type,
      start_datetime,
      end_datetime,
      title: title || null
    });
    res.json({ success: true, block });
  } catch (error) {
    console.error('❌ Create availability block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/customers/me/availability-blocks/:id
 * Delete availability block
 */
router.delete('/customers/me/availability-blocks/:id', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const deleted = ProviderService.deleteAvailabilityBlock(customer.email, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Block not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Delete availability block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/customers/me/availability-status
 * Set provider online/offline (session-based)
 */
router.patch('/customers/me/availability-status', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const { is_online } = req.body || {};
    if (typeof is_online === 'boolean') {
      ProviderService.setProviderOnline(customer.email, is_online);
    }
    const status = ProviderService.getProviderStatus(customer.email);
    res.json({ success: true, status });
  } catch (error) {
    console.error('❌ Update availability status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/customers/me
 * Get current customer information
 */
router.get('/customers/me', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    if (!customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email first'
      });
    }

    // MANDATORY: Check if terms accepted (user must accept terms before accessing profile)
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing your profile. Please visit /terms to accept.'
      });
    }

    // Parse api_features if it's a JSON string
    let apiFeatures = customer.api_features;
    if (typeof apiFeatures === 'string' && apiFeatures) {
      try {
        apiFeatures = JSON.parse(apiFeatures);
      } catch (e) {
        apiFeatures = [];
      }
    } else if (!apiFeatures) {
      apiFeatures = [];
    }

    // Parse provider_profile if present (specialist portal data)
    let providerProfile = customer.provider_profile;
    if (typeof providerProfile === 'string' && providerProfile) {
      try {
        providerProfile = JSON.parse(providerProfile);
      } catch (e) {
        providerProfile = null;
      }
    }

    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone_number: customer.phone_number,
        twilio_phone_number: customer.twilio_phone_number || null,
        company_name: customer.company_name,
        business_size: customer.business_size,
        api_features: apiFeatures,
        provider_profile: providerProfile || null,
        plan_tier: customer.plan_tier,
        status: customer.status,
        email_verified: customer.email_verified === 1,
        retell_agent_id: customer.retell_agent_id,
        retell_agent_status: customer.retell_agent_status,
        stripe_customer_id: customer.stripe_customer_id || null,
        merchant_id: customer.merchant_id || null,
        password_updated_at: customer.password_updated_at || null,
        created_at: customer.created_at
      }
    });
  } catch (error) {
    console.error('❌ Get customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve customer information',
      message: error.message
    });
  }
});

/**
 * PATCH /api/customers/me/profile
 * Update editable profile fields for current customer.
 */
router.patch('/customers/me/profile', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const body = req.body || {};
    const updates = {};
    const before = {
      company_name: customer.company_name || null,
      phone_number: customer.phone_number || null,
      provider_profile: customer.provider_profile || null
    };

    if (typeof body.company_name === 'string') {
      updates.company_name = body.company_name.trim().slice(0, 200);
    }
    if (typeof body.phone_number === 'string') {
      updates.phone_number = body.phone_number.trim().slice(0, 50);
    }
    if (body.provider_profile && typeof body.provider_profile === 'object') {
      let existingProfile = null;
      if (typeof customer.provider_profile === 'string' && customer.provider_profile) {
        try { existingProfile = JSON.parse(customer.provider_profile); } catch (_) { existingProfile = null; }
      } else if (customer.provider_profile && typeof customer.provider_profile === 'object') {
        existingProfile = customer.provider_profile;
      }
      updates.provider_profile = JSON.stringify({
        ...(existingProfile || {}),
        ...body.provider_profile
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No editable fields provided' });
    }

    if (typeof updates.phone_number === 'string') {
      const normalized = updates.phone_number.replace(/[^\d+]/g, '');
      updates.phone_number = normalized.slice(0, 24);
    }
    db.updateCustomer(customer.id, updates);
    const fresh = db.getCustomer(customer.id);
    let providerProfile = fresh.provider_profile;
    if (typeof providerProfile === 'string' && providerProfile) {
      try { providerProfile = JSON.parse(providerProfile); } catch (_) { providerProfile = null; }
    }

    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customer.id,
        'profile_update',
        JSON.stringify(before),
        JSON.stringify(updates),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}

    return res.json({
      success: true,
      customer: {
        id: fresh.id,
        name: fresh.name,
        email: fresh.email,
        phone_number: fresh.phone_number,
        company_name: fresh.company_name,
        provider_profile: providerProfile || null
      }
    });
  } catch (error) {
    console.error('❌ Update customer profile error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update profile', message: error.message });
  }
});

router.get('/customers/me/notification-settings', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const row = db.db.prepare(`
      SELECT * FROM customer_notification_settings WHERE customer_id = ?
    `).get(customerId) || {
      customer_id: customerId,
      order_notifications: 1,
      fraud_alerts: 1,
      weekly_reports: 1
    };
    res.json({
      success: true,
      settings: {
        order_notifications: !!row.order_notifications,
        fraud_alerts: !!row.fraud_alerts,
        weekly_reports: !!row.weekly_reports
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/customers/me/notification-settings', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const body = req.body || {};
    const next = {
      order_notifications: body.order_notifications === false ? 0 : 1,
      fraud_alerts: body.fraud_alerts === false ? 0 : 1,
      weekly_reports: body.weekly_reports === false ? 0 : 1
    };
    db.db.prepare(`
      INSERT INTO customer_notification_settings (customer_id, order_notifications, fraud_alerts, weekly_reports, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(customer_id) DO UPDATE SET
        order_notifications = excluded.order_notifications,
        fraud_alerts = excluded.fraud_alerts,
        weekly_reports = excluded.weekly_reports,
        updated_at = CURRENT_TIMESTAMP
    `).run(customerId, next.order_notifications, next.fraud_alerts, next.weekly_reports);
    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customerId,
        'notification_settings_update',
        null,
        JSON.stringify(next),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}
    res.json({
      success: true,
      settings: {
        order_notifications: !!next.order_notifications,
        fraud_alerts: !!next.fraud_alerts,
        weekly_reports: !!next.weekly_reports
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/customers/me/sessions', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const currentSession = req.cookies?.customer_session || null;
    const sessions = db.db.prepare(`
      SELECT id, ip_address, user_agent, created_at, last_accessed_at, expires_at
      FROM customer_sessions
      WHERE customer_id = ? AND expires_at > datetime('now')
      ORDER BY datetime(last_accessed_at) DESC, datetime(created_at) DESC
      LIMIT 20
    `).all(customerId);
    res.json({
      success: true,
      sessions: sessions.map((s) => ({ ...s, is_current: currentSession === s.id }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/customers/me/sessions/:id', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) return res.status(400).json({ success: false, error: 'Session id required' });
    const row = db.db.prepare(`SELECT id FROM customer_sessions WHERE id = ? AND customer_id = ?`).get(sessionId, customerId);
    if (!row) return res.status(404).json({ success: false, error: 'Session not found' });
    db.deleteCustomerSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/customers/me/sessions/revoke-others', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const currentSession = req.cookies?.customer_session || '';
    db.db.prepare(`
      DELETE FROM customer_sessions
      WHERE customer_id = ? AND id != ?
    `).run(customerId, currentSession);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/customers/me/email-change/request', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const newEmail = String(req.body?.new_email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }
    if (newEmail === String(customer.email || '').toLowerCase()) {
      return res.status(400).json({ success: false, error: 'New email must be different' });
    }
    const existing = db.getCustomerByEmail(newEmail);
    if (existing && existing.id !== customer.id) {
      return res.status(409).json({ success: false, error: 'Email already in use' });
    }
    db.db.prepare(`UPDATE email_change_requests SET status = 'cancelled' WHERE customer_id = ? AND status = 'pending'`).run(customer.id);
    const reqId = `ecr_${require('crypto').randomBytes(8).toString('hex')}`;
    db.db.prepare(`
      INSERT INTO email_change_requests (id, customer_id, old_email, new_email, status, requested_at, expires_at)
      VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, datetime('now', '+30 minutes'))
    `).run(reqId, customer.id, customer.email, newEmail);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    db.createEmailVerificationCode(newEmail, code, customer.id);
    try { await EmailService.sendVerificationCode(newEmail, code); } catch (_) {}
    res.json({ success: true, message: 'Verification code sent to new email' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/customers/me/email-change/confirm', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const newEmail = String(req.body?.new_email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!newEmail || !code) return res.status(400).json({ success: false, error: 'new_email and code required' });
    const reqRow = db.db.prepare(`
      SELECT * FROM email_change_requests
      WHERE customer_id = ? AND new_email = ? AND status = 'pending' AND expires_at > datetime('now')
      ORDER BY requested_at DESC LIMIT 1
    `).get(customer.id, newEmail);
    if (!reqRow) return res.status(400).json({ success: false, error: 'No pending request for this email' });
    const verification = db.verifyEmailCode(newEmail, code);
    if (!verification) return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    db.updateCustomer(customer.id, { email: newEmail, email_verified: 1 });
    db.db.prepare(`
      UPDATE email_change_requests
      SET status = 'verified', verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reqRow.id);
    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customer.id,
        'email_change_confirmed',
        JSON.stringify({ email: customer.email }),
        JSON.stringify({ email: newEmail }),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}
    res.json({ success: true, email: newEmail });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/customers/me/services-status', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const merchant = customer?.merchant_id ? db.getMerchant(customer.merchant_id) : null;
    res.json({
      success: true,
      services: {
        stripe: {
          connected: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim()),
          detail: customer?.stripe_customer_id ? `Customer ${customer.stripe_customer_id}` : 'Not linked yet'
        },
        twilio: {
          connected: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
          detail: customer?.twilio_phone_number || 'No number assigned'
        },
        google_calendar: { connected: false, detail: 'See Google Calendar card below' },
        shopify: { connected: false, detail: merchant?.api_url || 'Not connected' }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customers/me/export
 * Request a data export (returns JSON summary of account data)
 */
router.post('/customers/me/export', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const customerId = customer.id;

    const customerRow = db.getCustomer(customerId);
    const merchant = customerRow?.merchant_id ? db.getMerchant(customerRow.merchant_id) : null;
    const invoices = db.getCustomerInvoices ? db.getCustomerInvoices(customerId) : [];
    const notifSettings = db.db.prepare('SELECT * FROM customer_notification_settings WHERE customer_id = ?').get(customerId);
    const credits = db.db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);

    const exportData = {
      exported_at: new Date().toISOString(),
      customer: customerRow ? {
        id: customerRow.id,
        name: customerRow.name,
        email: customerRow.email,
        company_name: customerRow.company_name,
        phone_number: customerRow.phone_number,
        plan_tier: customerRow.plan_tier,
        created_at: customerRow.created_at
      } : null,
      merchant: merchant ? {
        id: merchant.id,
        name: merchant.name,
        webhook_url: merchant.webhook_url,
        created_at: merchant.created_at
      } : null,
      invoices: (invoices || []).slice(0, 50).map(inv => ({
        invoice_number: inv.invoice_number,
        billing_month: inv.billing_month,
        total: inv.total,
        status: inv.status,
        due_date: inv.due_date
      })),
      notification_settings: notifSettings || null,
      credits: credits || null
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="doclittle-export-${customerId}-${Date.now()}.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Failed to export data', message: error.message });
  }
});

/**
 * POST /api/customers/me/close-account
 * Soft-close account (sets status to closed, revokes all sessions)
 */
router.post('/customers/me/close-account', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const { confirm_phrase } = req.body || {};
    if (confirm_phrase !== 'DELETE FOREVER') {
      return res.status(400).json({
        success: false,
        error: 'You must type DELETE FOREVER to confirm account closure'
      });
    }

    db.updateCustomer(customer.id, { status: 'closed', updated_at: new Date().toISOString() });
    db.db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customer.id);

    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customer.id,
        'account_closed',
        JSON.stringify({ status: customer.status }),
        JSON.stringify({ status: 'closed' }),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}

    res.json({
      success: true,
      message: 'Account closed. You have been signed out.'
    });
  } catch (error) {
    console.error('Close account error:', error);
    res.status(500).json({ success: false, error: 'Failed to close account', message: error.message });
  }
});

/**
 * GET /api/customers/me/feature-requests
 * Get customer's feature request history
 */
router.get('/customers/me/feature-requests', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing feature requests. Please visit /terms to accept.'
      });
    }

    const requests = db.getCustomerFeatureRequests(session.customer_id);
    res.json({
      success: true,
      requests: requests || []
    });
  } catch (error) {
    console.error('❌ Get feature requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feature requests',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/me/feature-requests
 * Create new feature requests
 */
router.post('/customers/me/feature-requests', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const { features } = req.body;
    if (!features || !Array.isArray(features) || features.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of features to request'
      });
    }

    // Get current customer to check existing features
    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    if (!customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before submitting feature requests. Please visit /terms to accept.'
      });
    }

    // Parse existing features
    let existingFeatures = customer.api_features;
    if (typeof existingFeatures === 'string' && existingFeatures) {
      try {
        existingFeatures = JSON.parse(existingFeatures);
      } catch (e) {
        existingFeatures = [];
      }
    } else if (!existingFeatures) {
      existingFeatures = [];
    }

    // Filter out features they already have
    const newFeatures = features.filter(f => !existingFeatures.includes(f));

    if (newFeatures.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'You already have access to all selected features'
      });
    }

    // Create feature requests
    const createdRequests = [];
    for (const featureName of newFeatures) {
      try {
        db.createFeatureRequest(session.customer_id, featureName, null, null);
        createdRequests.push(featureName);
      } catch (error) {
        console.error(`Failed to create feature request for ${featureName}:`, error);
      }
    }

    // Send email notification to admin if requests were created
    if (createdRequests.length > 0) {
      try {
        const EmailService = require('../services/email-service');
        await EmailService.sendFeatureRequestNotification(
          customer.email,
          customer.name || customer.company_name || 'Customer',
          createdRequests,
          customer.company_name || 'N/A'
        );
        console.log(`📧 Feature request notification sent for ${createdRequests.length} feature(s) from ${customer.email}`);
      } catch (emailError) {
        console.error('⚠️  Failed to send feature request notification:', emailError);
        // Don't fail the request if email fails
      }
    }

    res.json({
      success: true,
      message: `Successfully requested ${createdRequests.length} feature(s)`,
      requested_features: createdRequests
    });
  } catch (error) {
    console.error('❌ Create feature requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create feature requests',
      message: error.message
    });
  }
});

router.get('/customers/me/payment-method', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing payment method. Please visit /terms to accept.'
      });
    }

    const paymentMethod = db.getCustomerPaymentMethod(session.customer_id);

    res.json({
      success: true,
      payment_method: paymentMethod || null
    });
  } catch (error) {
    console.error('❌ Get payment method error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment method',
      message: error.message
    });
  }
});

router.post('/customer/landing/claim-session', rateLimiter, requireCustomerAuth, express.json(), async (req, res) => {
  try {
    ensureClaimSessionTables();
    const landingSessionId = String(req.body?.landing_session_id || '').trim();
    if (!landingSessionId) {
      return res.status(400).json({
        success: false,
        error: 'landing_session_id required'
      });
    }

    const ipHash = crypto
      .createHash('sha256')
      .update(String(req.ip || '') + '|' + String(req.headers['x-forwarded-for'] || ''))
      .digest('hex')
      .slice(0, 24);
    const out = claimLandingSessionToCustomer({
      customerId: req.customer?.id,
      merchantId: req.customer?.merchant_id || null,
      landingSessionId,
      ipHash,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 240)
    });
    if (!out.success) {
      return res.status(Number(out.status) || 400).json({ success: false, error: out.error || 'claim_failed' });
    }
    return res.json(out);
  } catch (error) {
    console.error('❌ Claim session error:', error);
    return res.status(500).json({ success: false, error: 'claim_session_failed', message: error.message });
  }
});

/**
 * GET /api/customer/products
 * Minimal claimed scan shelf list for authenticated customer.
 */
router.get('/customer/products', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    ensureClaimSessionTables();
    const products = listCustomerProducts({
      customerId: req.customer?.id,
      limit: req.query?.limit
    });
    return res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error) {
    console.error('❌ Customer products list error:', error);
    return res.status(500).json({ success: false, error: 'customer_products_list_failed', message: error.message });
  }
});

module.exports = router;
