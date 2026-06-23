'use strict';

/**
 * Journey gate checks (Session 5): coding → quote → booking/payment
 */

const TriageRAGService = require('../clinical/triage-rag-service');
const {
  CODING_CONFIDENCE_THRESHOLD,
  isConfidenceNearThreshold
} = require('../../config/coding-thresholds');

const THRESHOLD = CODING_CONFIDENCE_THRESHOLD;

const HOLDING = {
  coding: 'Let me get a bit more information about your symptoms before we schedule anything.',
  quote: 'I want to confirm your coverage details before I quote an exact amount.',
  payment: 'I will share your copay amount first, then we can take payment.',
  booking_after_quote: 'Once I have confirmed your copay, we can finish booking your visit.'
};

function bumpGateViolation(db, sessionId, gate) {
  try {
    if (db?.insertKellyCallEvent) {
      db.insertKellyCallEvent({
        session_id: sessionId,
        event_type: 'gate_violation',
        payload_json: JSON.stringify({ gate, at: new Date().toISOString() })
      });
    }
  } catch (_) {}
}

function checkCodingGate({ sessionId, triageRow, db }) {
  const triage = TriageRAGService.getAuthoritativeForSession(sessionId);
  const rawConfidence = triage?.rag_confidence ?? triage?.confidence ?? 0;
  const confidence = Math.round(rawConfidence * 100) / 100;
  const complete = triageRow?.triage_complete === 1 || triageRow?.triage_complete === true;

  if (!complete) {
    bumpGateViolation(db, sessionId, 'coding');
    return {
      allowed: false,
      holding_utterance: HOLDING.coding,
      reason: 'coding_incomplete_or_low_confidence',
      confidence,
      threshold: THRESHOLD
    };
  }

  if (sessionId) {
    const { resolveInsuranceCodes } = require('../shared/resolve-insurance-codes');
    const resolved = resolveInsuranceCodes(sessionId, {});
    if (!resolved.ok) {
      bumpGateViolation(db, sessionId, 'coding');
      return {
        allowed: false,
        holding_utterance: HOLDING.coding,
        reason: resolved.error_code || resolved.status || 'coding_incomplete_or_low_confidence',
        confidence,
        threshold: THRESHOLD
      };
    }
  }

  const hasCodes = !!(triage?.primary_icd10);
  const ok = hasCodes && confidence >= THRESHOLD;
  if (!ok) bumpGateViolation(db, sessionId, 'coding');
  return {
    allowed: ok,
    holding_utterance: HOLDING.coding,
    reason: ok ? null : 'coding_incomplete_or_low_confidence',
    confidence,
    threshold: THRESHOLD
  };
}

function checkQuoteGate({ quoteResult }) {
  const status = quoteResult?.status || 'cannot_determine';
  const ok = status === 'hard_number';
  return {
    allowed: ok,
    holding_utterance: HOLDING.quote,
    reason: ok ? null : 'quote_not_hard_number',
    status
  };
}

function quoteDeliveredFlag(sessionFlags = {}) {
  const v = sessionFlags.quote_delivered;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function checkPaymentGate({ sessionFlags = {} }) {
  const ok = quoteDeliveredFlag(sessionFlags);
  return {
    allowed: ok,
    holding_utterance: HOLDING.payment,
    reason: ok ? null : 'quote_not_delivered'
  };
}

function checkBookingAfterQuoteGate({ sessionFlags = {} }) {
  const ok = quoteDeliveredFlag(sessionFlags);
  return {
    allowed: ok,
    holding_utterance: HOLDING.booking_after_quote,
    reason: ok ? null : 'quote_not_delivered_before_booking'
  };
}

module.exports = {
  checkCodingGate,
  checkQuoteGate,
  checkPaymentGate,
  checkBookingAfterQuoteGate,
  HOLDING,
  THRESHOLD,
  isConfidenceNearThreshold
};
