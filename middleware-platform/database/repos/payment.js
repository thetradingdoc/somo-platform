'use strict';

/**
 * Payment table accessors for P3 finance rails.
 * LEGACY_CONSUMER tables (voice_checkouts, merchant_orders) — do not extend for new health copay flow.
 */
const db = require('../../database');

function getDb() {
  return db.db || db;
}

function getCheckoutSession(checkoutId) {
  if (!checkoutId) return null;
  try {
    return getDb().prepare('SELECT * FROM checkout_sessions WHERE id = ?').get(checkoutId);
  } catch (_) {
    return null;
  }
}

/** @deprecated LEGACY_CONSUMER — skincare/voice commerce checkout */
function getVoiceCheckout(checkoutId) {
  if (!checkoutId || !db.getVoiceCheckout) return null;
  return db.getVoiceCheckout(checkoutId);
}

/** @deprecated LEGACY_CONSUMER */
function getMerchantOrder(orderId) {
  if (!orderId) return null;
  try {
    return getDb().prepare('SELECT * FROM merchant_orders WHERE id = ?').get(orderId);
  } catch (_) {
    return null;
  }
}

function listPaymentReceiptsByCheckout(checkoutId) {
  if (!checkoutId) return [];
  try {
    return getDb().prepare('SELECT * FROM payment_receipts WHERE checkout_id = ?').all(checkoutId);
  } catch (_) {
    return [];
  }
}

module.exports = {
  getCheckoutSession,
  getVoiceCheckout,
  getMerchantOrder,
  listPaymentReceiptsByCheckout
};
