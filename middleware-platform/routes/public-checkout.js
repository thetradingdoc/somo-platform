const express = require('express');
const router = express.Router();
const db = require('../database');
const constants = require('../utils/constants');
const { v4: uuidv4 } = require('uuid');

function resolveMerchantId(req) {
  if (req.body?.merchant_id) return req.body.merchant_id;
  const host = req.headers.host || '';
  const parts = host.split('.');
  if (parts.length > 2) {
    const sub = parts[0];
    const m = db.getMerchantBySubdomain(sub);
    if (m) return m.id;
  }
  const defSub = constants.TENANTS?.DEFAULT_SUBDOMAIN || 'akin-dunbar';
  const def = db.getMerchantBySubdomain(defSub);
  return def ? def.id : null;
}

// Basic customer ensure/create for public checkout (unauthenticated)
router.post('/start', (req, res) => {
  try {
    const { email, phone, name } = req.body || {};
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(400).json({ success: false, error: 'merchant_not_found' });
    }
    if (!email && !phone) {
      return res.status(400).json({ success: false, error: 'email_or_phone_required' });
    }

    let customer = null;
    if (email) customer = db.getCustomerByEmail(email);
    if (!customer && phone) customer = db.getCustomerByPhone(phone);

    if (!customer) {
      const id = uuidv4();
      db.createCustomer({
        id,
        name: name || email || phone || 'Customer',
        email: email || null,
        phone_number: phone || null,
        merchant_id: merchantId,
        status: 'active',
        customer_type: 'shop'
      });
      customer = db.getCustomer(id);
    }

    // Ensure wallet exists (best-effort)
    try {
      const CircleService = require('../services/circle-service');
      if (CircleService && CircleService.isAvailable && CircleService.isAvailable()) {
        CircleService.getOrCreateCustomerWallet(customer.id, { merchantId: merchantId, createIfNotExists: true });
      }
    } catch (_) {}

    return res.json({
      success: true,
      customer: {
        id: customer.id,
        email: customer.email,
        phone_number: customer.phone_number,
        merchant_id: merchantId
      }
    });
  } catch (error) {
    console.error('Public checkout start error:', error);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;

