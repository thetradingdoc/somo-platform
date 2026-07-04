'use strict';

/**
 * Copay desk parity helpers — per-session and cohort-level.
 * Used by Jest, multilang harness, dental-pstn DENTAL-003, and verify-pilot-copay-desk-parity.cjs
 */

const KellyToolExecutor = require('../../services/kelly-tool-executor');

const THRESHOLD_USD = 5;
const MIN_CALLS = 10;
const MIN_PARITY_PCT = 90;

function loadDb() {
  return require('../../database');
}

/**
 * Per-session: voice quoted amount vs rcm_payments row for session.
 */
function assertSessionCopayParity({ sessionId, patientId, clinicId, toleranceUsd = 0.01 } = {}) {
  const db = loadDb();
  if (!db.db) {
    return { ok: false, reason: 'db_unavailable' };
  }

  const voiceQuoted = Number(KellyToolExecutor._getSessionMeta(sessionId, 'last_copay_due'));
  if (!voiceQuoted && voiceQuoted !== 0) {
    return { ok: false, reason: 'no_voice_quote', sessionId, voiceQuoted: null };
  }

  let payment = null;
  try {
    payment = db.db
      .prepare(
        `SELECT id, amount, status, pay_token FROM rcm_payments
         WHERE session_id = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(sessionId);
  } catch (_) {
    payment = null;
  }
  if (!payment && patientId && clinicId) {
    try {
      payment = db.db
        .prepare(
          `SELECT id, amount, status, pay_token FROM rcm_payments
           WHERE patient_id = ? AND clinic_id = ?
           ORDER BY rowid DESC LIMIT 1`
        )
        .get(patientId, clinicId);
    } catch (_) {}
  }

  if (!payment) {
    return {
      ok: false,
      reason: 'no_payment_row',
      sessionId,
      voiceQuoted,
      paymentAmount: null,
      delta: null
    };
  }

  const paymentAmount = Number(payment.amount);
  const delta = Math.abs(voiceQuoted - paymentAmount);
  return {
    ok: delta <= toleranceUsd,
    sessionId,
    voiceQuoted,
    paymentAmount,
    paymentStatus: payment.status,
    payToken: payment.pay_token,
    delta
  };
}

/**
 * Cohort-level pilot desk parity over amount_resolution_log.
 */
function runPilotDeskParityReport({ clinicId, strict = false } = {}) {
  const db = loadDb();
  if (!db.db) {
    return { ok: !strict, reason: 'db_unavailable', rows: 0, parityPct: 0 };
  }

  let sql = `
    SELECT quoted_amount, charged_amount, session_id, created_at
    FROM amount_resolution_log
    WHERE quoted_amount IS NOT NULL AND charged_amount IS NOT NULL
  `;
  const params = [];
  if (clinicId) {
    sql += ` AND session_id IN (
      SELECT session_id FROM kelly_sessions WHERE clinic_id = ?
    )`;
    params.push(clinicId);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';

  let rows = [];
  try {
    rows = db.db.prepare(sql).all(...params);
  } catch (e) {
    try {
      rows = db.db
        .prepare(
          `SELECT quoted_amount, charged_amount, session_id, created_at
           FROM amount_resolution_log
           WHERE quoted_amount IS NOT NULL AND charged_amount IS NOT NULL
           ORDER BY created_at DESC LIMIT 500`
        )
        .all();
    } catch (_2) {
      return { ok: !strict, reason: 'log_unavailable', error: e.message, rows: 0, parityPct: 0 };
    }
  }

  if (!rows.length) {
    return {
      ok: !strict,
      informational: true,
      reason: 'no_rows',
      rows: 0,
      parityPct: 0,
      mismatches: []
    };
  }

  const within = rows.filter((r) => Math.abs(r.quoted_amount - r.charged_amount) <= THRESHOLD_USD + 0.009);
  const mismatches = rows.filter((r) => Math.abs(r.quoted_amount - r.charged_amount) > 0.009);
  const parityPct = Math.round((within.length / rows.length) * 100);
  const enoughCalls = rows.length >= MIN_CALLS;
  const parityOk = parityPct >= MIN_PARITY_PCT;
  const ok = !strict || ((!enoughCalls && rows.length === 0) || (enoughCalls && parityOk));

  return {
    ok,
    rows: rows.length,
    within: within.length,
    parityPct,
    mismatches: mismatches.slice(0, 10),
    enoughCalls,
    minCalls: MIN_CALLS,
    minParityPct: MIN_PARITY_PCT,
    thresholdUsd: THRESHOLD_USD
  };
}

module.exports = {
  THRESHOLD_USD,
  MIN_CALLS,
  MIN_PARITY_PCT,
  assertSessionCopayParity,
  runPilotDeskParityReport
};
