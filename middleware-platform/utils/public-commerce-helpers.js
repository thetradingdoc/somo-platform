const db = require('../database');
const constants = require('../utils/constants');
const { resolveProviderId } = require('./naming-aliases');

function resolveMerchantId(req) {
  const q = req.query || {};
  const b = req.body || {};
  const providerId = resolveProviderId(b) || resolveProviderId(q);
  if (providerId) return providerId;
  const host = req.headers.host || '';
  const parts = host.split('.');
  if (parts.length > 2) {
    const sub = parts[0];
    const m = db.getMerchantBySubdomain(sub);
    if (m) return m.id;
  }
  const defSub = constants.TENANTS?.DEFAULT_SUBDOMAIN || 'akin-dunbar';
  const def = db.getMerchantBySubdomain(defSub);
  if (def) return def.id;
  const envDefault = String(process.env.PUBLIC_CATALOG_DEFAULT_PROVIDER_ID || '').trim();
  if (envDefault) return envDefault;
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
  if (!isProd && typeof db.getAllMerchants === 'function') {
    try {
      const all = db.getAllMerchants();
      if (!Array.isArray(all) || !all.length || all[0]?.id == null) return null;
      if (all.length === 1) return all[0].id;
      if (isDev) return all[0].id;
    } catch (_) {}
  }
  return null;
}

function parseCheckoutSessionData(raw) {
  if (raw == null || raw === '') return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

function isQuoteExpired(row) {
  if (!row?.expires_at) return false;
  const t = Date.parse(row.expires_at);
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

function resolveMerchantIdForCheckoutChat({ providerId, clinicId }) {
  const fromArgs = providerId && String(providerId).trim();
  if (fromArgs) return fromArgs;
  if (!clinicId) return null;
  try {
    const c = db.getClinic ? db.getClinic(clinicId) : null;
    return c?.merchant_id ? String(c.merchant_id).trim() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Parse a small set of English quantity phrases ("I want one", "qty 2") for cart alignment.
 * Returns null when not clearly a quantity-only intent.
 */
function inferCommerceQuantityFromMessage(message) {
  const m = String(message || '').trim().toLowerCase();
  if (m.length < 2 || m.length > 400) return null;
  let mm = m.match(/\b(?:qty|quantity)\s*[:=]?\s*(\d{1,3})\b/i);
  if (mm) return Math.min(999, Math.max(1, parseInt(mm[1], 10)));
  mm = m.match(/\b(\d{1,3})\s*(?:x|×)?\s*(?:bottle|bottles|jar|jars|unit|units|item|items)?\s*$/);
  if (mm && /want|need|only|just|give|order|buy|add|cart|get|take/i.test(m)) {
    return Math.min(999, Math.max(1, parseInt(mm[1], 10)));
  }
  if (
    /\b(just |only |i want |i need |need |give me |get me )(?:one|1)\b/.test(m) ||
    /\bone (?:bottle|jar|unit|item)\b/.test(m) ||
    /\ba single\b/.test(m)
  ) {
    return 1;
  }
  if (/\b(two|both)\b/.test(m) && /want|need|only|just|cart|qty|quantity|bottle|item/i.test(m)) {
    return 2;
  }
  if (/\bthree\b/.test(m) && /want|need|only|just|cart|qty|quantity|bottle|item/i.test(m)) {
    return 3;
  }
  return null;
}

function cartItemFromProduct(product, quantity) {
  const qty = Math.max(1, Number(quantity) || 1);
  const unit = Number(product.price || 0);
  return {
    product_id: product.id,
    name: product.name,
    unit_price: unit,
    quantity: qty,
    total: Number((unit * qty).toFixed(2))
  };
}

/**
 * Apply quantity from user message to the commerce cart when unambiguous (single SKU or explicit product_id).
 */
async function applyCommerceQuantityIntentIfEligible({ message, sessionId, merchantId, productId }) {
  if (!message || !sessionId || !merchantId) return { applied: false };
  if (await db.isCommerceCartLocked(sessionId, merchantId)) return { applied: false };
  const qty = inferCommerceQuantityFromMessage(message);
  if (qty == null) return { applied: false };

  let targetPid = productId && String(productId).trim();
  const cart = db.getCommerceCart(sessionId, merchantId);
  const items = Array.isArray(cart?.items) ? cart.items : [];
  if (!targetPid) {
    if (items.length !== 1) return { applied: false };
    targetPid = items[0].product_id;
  }
  if (!targetPid) return { applied: false };

  const product = db.getProduct(targetPid);
  if (!product) return { applied: false };
  if (product.merchant_id && product.merchant_id !== merchantId) return { applied: false };

  let nextItems = [...items];
  const idx = nextItems.findIndex((it) => it.product_id === targetPid);
  const nextItem = cartItemFromProduct(product, qty);
  if (idx >= 0) nextItems[idx] = nextItem;
  else nextItems.push(nextItem);

  db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items: nextItems });
  return { applied: true, quantity: qty, product_id: targetPid };
}

module.exports = {
  resolveMerchantId,
  parseCheckoutSessionData,
  isQuoteExpired,
  resolveMerchantIdForCheckoutChat,
  inferCommerceQuantityFromMessage,
  applyCommerceQuantityIntentIfEligible
};
