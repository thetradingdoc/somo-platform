const db = require('../database');
const constants = require('../utils/constants');
const { resolveProviderId } = require('./naming-aliases');

function resolveMerchantId(req) {
  const providerId = resolveProviderId(req.body || {});
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
  return def ? def.id : null;
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

module.exports = {
  resolveMerchantId,
  parseCheckoutSessionData,
  isQuoteExpired
};
