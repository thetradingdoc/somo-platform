const express = require('express');
const router = express.Router();
const db = require('../database');
const constants = require('../utils/constants');

/**
 * Resolve merchant_id from query or subdomain.
 */
function resolveMerchantId(req) {
  if (req.query.merchant_id) return req.query.merchant_id;

  // Try from subdomain
  const host = req.headers.host || '';
  const parts = host.split('.');
  if (parts.length > 2) {
    const subdomain = parts[0];
    const m = db.getMerchantBySubdomain(subdomain);
    if (m) return m.id;
  }

  // Default tenant fallback
  const defaultSub = constants.TENANTS?.DEFAULT_SUBDOMAIN || 'akin-dunbar';
  const def = db.getMerchantBySubdomain(defaultSub);
  return def ? def.id : null;
}

/**
 * GET /api/public/products
 * Public, read-only list of products for a merchant.
 * Optional merchant_id query param; otherwise resolved by subdomain or default tenant.
 */
router.get('/', (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(404).json({ success: false, error: 'merchant_not_found' });
    }
    const products = db.getProductsByMerchant(merchantId) || [];
    return res.json({ success: true, products, merchant_id: merchantId, count: products.length });
  } catch (error) {
    console.error('Public products error:', error);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;

