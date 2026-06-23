/**
 * Voice SaaS subscription billing API (provider portal).
 */

const express = require('express');
const db = require('../database');
const { listTiers, listTopupPacks } = require('../services/platform/plan-catalog');
const {
  createSubscriptionCheckout,
  createTopupCheckout,
  getBillingStatus
} = require('../services/voice/voice-billing-stripe');
const { authLimiter } = require('../middleware/rate-limiter');

const router = express.Router();

function getCustomerFromSession(req) {
  const sessionId = req.cookies?.customer_session;
  if (!sessionId) return null;
  const session = db.getCustomerSession(sessionId);
  if (!session) return null;
  return db.getCustomer(session.customer_id);
}

router.get('/catalog', authLimiter, (req, res) => {
  res.json({
    success: true,
    tiers: listTiers(),
    topup_packs: listTopupPacks()
  });
});

router.get('/status', authLimiter, (req, res) => {
  const customer = getCustomerFromSession(req);
  if (!customer) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const status = getBillingStatus(customer.id);
  res.json({ success: true, billing: status });
});

router.post('/checkout/subscription', authLimiter, async (req, res) => {
  try {
    const customer = getCustomerFromSession(req);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const tierId = req.body?.tier || req.body?.plan_tier || 'starter';
    const vertical = req.body?.vertical || customer.billing_vertical || 'general';
    const result = await createSubscriptionCheckout(customer.id, tierId, vertical);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[VoiceBilling] subscription checkout:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/trial-welcome-dismiss', authLimiter, (req, res) => {
  const customer = getCustomerFromSession(req);
  if (!customer) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  db.updateCustomer(customer.id, { trial_welcome_dismissed_at: new Date().toISOString() });
  res.json({ success: true });
});

router.post('/checkout/topup', authLimiter, async (req, res) => {
  try {
    const customer = getCustomerFromSession(req);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const packId = req.body?.pack_id;
    if (!packId) {
      return res.status(400).json({ success: false, error: 'pack_id required' });
    }
    const result = await createTopupCheckout(customer.id, packId);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[VoiceBilling] topup checkout:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
