const express = require('express');
const router = express.Router();
const db = require('../database');
const { resolveMerchantId } = require('../utils/public-commerce-helpers');
const {
  withProviderAliases,
  mapProductsToPrescriptions,
  logAliasUsage
} = require('../utils/naming-aliases');

/**
 * GET /api/public/products
 * Public, read-only list of products for a merchant.
 * Optional merchant_id query param; otherwise resolved by subdomain or default tenant.
 */
router.get('/', (req, res) => {
  try {
    logAliasUsage('public-products', req);
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(404).json({ success: false, error: 'merchant_not_found' });
    }
    const products = db.getProductsByMerchant(merchantId) || [];
    return res.json(withProviderAliases({
      success: true,
      products,
      prescriptions: mapProductsToPrescriptions(products),
      count: products.length
    }, merchantId));
  } catch (error) {
    console.error('Public products error:', error);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;

