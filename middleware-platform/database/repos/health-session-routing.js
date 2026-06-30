'use strict';

const db = require('../../database');

function getDb() {
  return db.db || db;
}

function getBySessionId(sessionId) {
  if (!sessionId) return null;
  return getDb().prepare('SELECT * FROM health_session_routing WHERE session_id = ?').get(sessionId);
}

function upsertRow(row) {
  const existing = getBySessionId(row.sessionId);
  const now = new Date().toISOString();
  if (existing) {
    getDb()
      .prepare(
        `UPDATE health_session_routing SET
          eligibility_status = COALESCE(?, eligibility_status),
          eligible = COALESCE(?, eligible),
          copay_cents = COALESCE(?, copay_cents),
          payer_id = COALESCE(?, payer_id),
          member_id = COALESCE(?, member_id),
          network_status = COALESCE(?, network_status),
          urgency = COALESCE(?, urgency),
          pathway_summary = COALESCE(?, pathway_summary),
          payment_status = COALESCE(?, payment_status),
          stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
          routing_status = COALESCE(?, routing_status),
          routing_payload_json = COALESCE(?, routing_payload_json),
          paid_at = COALESCE(?, paid_at),
          updated_at = ?
        WHERE session_id = ?`
      )
      .run(
        row.eligibilityStatus ?? null,
        row.eligible == null ? null : (row.eligible ? 1 : 0),
        row.copayCents ?? null,
        row.payerId ?? null,
        row.memberId ?? null,
        row.networkStatus ?? null,
        row.urgency ?? null,
        row.pathwaySummary ?? null,
        row.paymentStatus ?? null,
        row.stripePaymentIntentId ?? null,
        row.routingStatus ?? null,
        row.routingPayloadJson ?? null,
        row.paidAt ?? null,
        now,
        row.sessionId
      );
  } else {
    getDb()
      .prepare(
        `INSERT INTO health_session_routing
         (session_id, eligibility_status, eligible, copay_cents, payer_id, member_id, network_status,
          urgency, pathway_summary, payment_status, stripe_payment_intent_id, routing_status,
          routing_payload_json, paid_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.sessionId,
        row.eligibilityStatus || 'pending',
        row.eligible == null ? null : (row.eligible ? 1 : 0),
        row.copayCents ?? null,
        row.payerId ?? null,
        row.memberId ?? null,
        row.networkStatus ?? null,
        row.urgency ?? null,
        row.pathwaySummary ?? null,
        row.paymentStatus || 'none',
        row.stripePaymentIntentId ?? null,
        row.routingStatus || 'pending',
        row.routingPayloadJson ?? null,
        row.paidAt ?? null,
        now
      );
  }
  return getBySessionId(row.sessionId);
}

function markPaid(sessionId, { stripePaymentIntentId, paidAt } = {}) {
  const now = paidAt || new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE health_session_routing SET
        payment_status = 'paid',
        routing_status = 'confirmed',
        stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
        paid_at = ?,
        updated_at = ?
      WHERE session_id = ?`
    )
    .run(stripePaymentIntentId || null, now, now, sessionId);
  return getBySessionId(sessionId);
}

function formatPublic(row) {
  if (!row) return null;
  let payload = null;
  try {
    if (row.routing_payload_json) payload = JSON.parse(row.routing_payload_json);
  } catch (_) {}
  return {
    session_id: row.session_id,
    eligibility_status: row.eligibility_status,
    eligible: row.eligible == null ? null : !!row.eligible,
    copay_cents: row.copay_cents,
    copay_display: row.copay_cents != null ? `$${(row.copay_cents / 100).toFixed(2)}` : null,
    payer_id: row.payer_id,
    network_status: row.network_status,
    urgency: row.urgency,
    pathway_summary: row.pathway_summary,
    payment_status: row.payment_status,
    routing_status: row.routing_status,
    stripe_payment_intent_id: row.stripe_payment_intent_id,
    paid_at: row.paid_at,
    payload
  };
}

module.exports = {
  getBySessionId,
  upsertRow,
  markPaid,
  formatPublic
};
