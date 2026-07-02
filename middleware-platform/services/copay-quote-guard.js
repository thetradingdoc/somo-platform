'use strict';

const db = require('../database');
const KellyToolExecutor = require('./kelly-tool-executor');
const { resolveTenantVoiceConfig } = require('./tenant-voice-config');

const DOLLAR_AMOUNT_RE = /\$\s*\d+(?:\.\d{1,2})?|\b\d+(?:\.\d{1,2})?\s*dollars?\b/gi;

function quoteDeliveredForSession(sessionId) {
  const v = KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered');
  return v === true || v === 'true' || v === 1 || v === '1';
}

function copaySpeakEnabled(clinicId, customerId = null) {
  try {
    const cfg = resolveTenantVoiceConfig(db, { clinicId, customerId });
    return cfg?.copay_quote_speak_enabled === true;
  } catch (_) {
    return false;
  }
}

function canSpeakCopayAmount({ clinicId, sessionId, customerId = null } = {}) {
  if (!copaySpeakEnabled(clinicId, customerId)) return false;
  return quoteDeliveredForSession(sessionId);
}

/**
 * Strip spoken dollar amounts when shadow mode or quote not delivered.
 */
function sanitizeCopayUtterance(text, { clinicId, sessionId, customerId = null } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  if (canSpeakCopayAmount({ clinicId, sessionId, customerId })) return raw;
  if (!DOLLAR_AMOUNT_RE.test(raw)) return raw;
  return raw
    .replace(DOLLAR_AMOUNT_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

module.exports = {
  canSpeakCopayAmount,
  copaySpeakEnabled,
  quoteDeliveredForSession,
  sanitizeCopayUtterance,
  DOLLAR_AMOUNT_RE
};
