'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

function logPaymentReconciliation(entry = {}) {
  if (!db.db) return null;
  const id = entry.id || `recon_${uuidv4()}`;
  try {
    db.db.prepare(`
      INSERT INTO payment_reconciliation_log (
        id, source, external_id, checkout_id, appointment_id, call_id,
        amount_cents, status, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.source || 'stripe',
      entry.external_id || null,
      entry.checkout_id || null,
      entry.appointment_id || null,
      entry.call_id || null,
      entry.amount_cents ?? null,
      entry.status || 'received',
      entry.details_json ? JSON.stringify(entry.details_json) : null
    );
    return id;
  } catch (e) {
    console.warn('[payment-reconciliation] log failed:', e.message);
    return null;
  }
}

module.exports = { logPaymentReconciliation };
