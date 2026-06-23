'use strict';

const axios = require('axios');
const db = require('../../database');

/**
 * Structured alert for commerce/checkout failures (audit row + optional webhook).
 * @param {{ event: string, detail?: string, payment_intent_id?: string|null, checkout_id?: string|null }} payload
 */
async function notifyCommerceCritical(payload) {
  const event = String(payload?.event || 'commerce_critical');
  const detail = String(payload?.detail || '').slice(0, 4000);
  const paymentIntentId = payload?.payment_intent_id || null;
  const checkoutId = payload?.checkout_id || null;

  try {
    db.insertAuditEvent({
      actor_type: 'system',
      actor_id: 'commerce',
      resource_type: 'commerce',
      resource_id: checkoutId || paymentIntentId || 'unknown',
      action: event,
      metadata: {
        detail,
        payment_intent_id: paymentIntentId,
        checkout_id: checkoutId,
        ts: new Date().toISOString()
      }
    });
  } catch (_) {}

  const url = process.env.COMMERCE_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await axios.post(
      url,
      {
        event,
        detail,
        payment_intent_id: paymentIntentId,
        checkout_id: checkoutId,
        ts: new Date().toISOString()
      },
      { timeout: 8000 }
    );
  } catch (_) {}
}

module.exports = { notifyCommerceCritical };
