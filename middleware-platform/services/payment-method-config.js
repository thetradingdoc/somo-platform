/**
 * Payment Method Selection (4.1)
 * Config/runtime selection of Stripe, Mastercard, Visa, link.
 *
 * Config sources (priority order):
 *   1. PAYMENT_METHODS_ALLOWED env (comma-separated, e.g. "link,stripe,mastercard,visa")
 *   2. Per-merchant: merchant.allowed_payment_methods (JSON array or comma string)
 *   3. Default: link, stripe (Stripe always allowed when configured)
 */

const db = require('../database');

const DEFAULT_ALLOWED = ['link', 'stripe'];

function parseAllowed(value) {
  if (!value || typeof value !== 'string') return null;
  return value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Get list of allowed payment methods for a merchant/context.
 * @param {string} merchantId - Optional merchant ID for per-merchant config
 * @returns {string[]} Allowed methods, e.g. ['link','stripe','mastercard','visa']
 */
function getAllowedPaymentMethods(merchantId = null) {
  let allowed = parseAllowed(process.env.PAYMENT_METHODS_ALLOWED);
  if (!allowed || allowed.length === 0) {
    allowed = [...DEFAULT_ALLOWED];
  }
  if (merchantId) {
    try {
      const merchant = db.getMerchant && db.getMerchant(merchantId);
      if (merchant && merchant.allowed_payment_methods) {
        const m = merchant.allowed_payment_methods;
        const arr = Array.isArray(m) ? m : (typeof m === 'string' ? parseAllowed(m) : null);
        if (arr && arr.length > 0) {
          allowed = arr.map(s => String(s).trim().toLowerCase());
        }
      }
    } catch (_) {}
  }
  return allowed;
}

/**
 * Check if a payment method is allowed.
 * @param {string} method - link, stripe, mastercard, visa
 * @param {string} merchantId - Optional
 * @returns {boolean}
 */
function isPaymentMethodAllowed(method, merchantId = null) {
  const allowed = getAllowedPaymentMethods(merchantId);
  const m = String(method || '').trim().toLowerCase();
  if (m === 'direct_stripe') return allowed.includes('stripe');
  return allowed.includes(m);
}

/**
 * Get payment methods that are both allowed AND configured (credentials present).
 * @param {string} merchantId - Optional
 * @returns {{ methods: string[], details: Record<string,{ configured: boolean, allowed: boolean }> }}
 */
function getAvailablePaymentMethods(merchantId = null) {
  const allowed = getAllowedPaymentMethods(merchantId);
  const details = {};
  const methods = [];

  const checks = [
    { key: 'link', configured: true },
    { key: 'stripe', configured: !!(process.env.STRIPE_SECRET_KEY) },
    { key: 'mastercard', configured: require('./mastercard-agent-pay-service').isConfigured() },
    { key: 'visa', configured: require('./visa-agent-toolkit-service').isConfigured() }
  ];

  for (const c of checks) {
    const isAllowed = allowed.includes(c.key);
    details[c.key] = { configured: c.configured, allowed: isAllowed };
    if (isAllowed && c.configured) {
      methods.push(c.key);
    }
  }

  return { methods, details };
}

module.exports = {
  getAllowedPaymentMethods,
  isPaymentMethodAllowed,
  getAvailablePaymentMethods
};
