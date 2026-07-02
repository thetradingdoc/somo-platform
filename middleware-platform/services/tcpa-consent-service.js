'use strict';

const db = require('../database');

function requireSmsConsentForPayment({ smsConsent, phone } = {}) {
  const hasPhone = phone && String(phone).replace(/\D/g, '').length >= 10;
  if (!hasPhone) return { ok: true, skipped: true };
  const consented = smsConsent === true || smsConsent === 1 || smsConsent === '1';
  if (!consented) {
    return {
      ok: false,
      error: 'SMS consent required before payment link texts',
      code: 'TCPA_SMS_CONSENT_REQUIRED'
    };
  }
  return { ok: true, consented_at: new Date().toISOString() };
}

function recordRcmSmsConsent(token) {
  if (!db.db || !token) return;
  try {
    db.db.prepare(`UPDATE rcm_payments SET sms_consent_at = datetime('now') WHERE pay_token = ?`).run(token);
  } catch (_) {}
}

function recordCheckoutSmsConsent(checkoutId) {
  if (!db.db || !checkoutId) return;
  try {
    db.db.prepare(`UPDATE voice_checkouts SET sms_consent_at = datetime('now') WHERE id = ?`).run(checkoutId);
  } catch (_) {}
}

module.exports = {
  requireSmsConsentForPayment,
  recordRcmSmsConsent,
  recordCheckoutSmsConsent
};
