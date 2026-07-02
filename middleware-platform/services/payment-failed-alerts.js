'use strict';

/**
 * Ops alerts when copay/checkout payments fail (PO-P1-5).
 */

const { logPaymentReconciliation } = require('./payment-reconciliation-audit');

function alertPaymentFailed(entry = {}) {
  const alert = {
    component: 'payment_failed_alert',
    checkout_id: entry.checkout_id || null,
    appointment_id: entry.appointment_id || null,
    call_id: entry.call_id || null,
    amount_cents: entry.amount_cents ?? null,
    external_id: entry.external_id || null,
    reason: entry.reason || 'payment_failed',
    clinic_id: entry.clinic_id || null
  };
  console.log(JSON.stringify(alert));

  logPaymentReconciliation({
    source: 'stripe',
    external_id: entry.external_id,
    checkout_id: entry.checkout_id,
    appointment_id: entry.appointment_id,
    call_id: entry.call_id,
    amount_cents: entry.amount_cents,
    status: 'failed',
    details_json: { reason: entry.reason, clinic_id: entry.clinic_id }
  });

  const webhook = process.env.PAYMENT_ALERT_SLACK_WEBHOOK || process.env.ELIGIBILITY_ALERT_SLACK_WEBHOOK;
  if (!webhook) return alert;
  try {
    const axios = require('axios');
    const amt =
      entry.amount_cents != null ? `$${(Number(entry.amount_cents) / 100).toFixed(2)}` : 'unknown';
    const text = `[Somo] Payment failed ${amt} appt=${entry.appointment_id || 'n/a'} checkout=${entry.checkout_id || 'n/a'}`;
    axios.post(webhook, { text }, { timeout: 5000 }).catch(() => {});
  } catch (_) {}
  return alert;
}

module.exports = { alertPaymentFailed };
