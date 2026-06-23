'use strict';

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const CVV_RE = /\b(cvv|cvc|security code)\b[:=\s-]*\d{3,4}\b/gi;
const TOKEN_RE = /\b(payment_token|client_secret|verification_code)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_\-]{4,})["']?/gi;

function redactText(input) {
  let s = String(input == null ? '' : input);
  s = s.replace(EMAIL_RE, '[REDACTED_EMAIL]');
  s = s.replace(CVV_RE, '$1:[REDACTED]');
  s = s.replace(CARD_RE, '[REDACTED_CARD]');
  s = s.replace(TOKEN_RE, (m, k) => `${k}:[REDACTED]`);
  return s;
}

function redactObject(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactObject);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/email|phone|token|secret|verification|card|cvv|cvc/i.test(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = redactObject(v);
  }
  return out;
}

function redactToolEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const safe = redactObject(event);
  if (safe.metadata && typeof safe.metadata === 'object') {
    if ('raw_args' in safe.metadata) safe.metadata.raw_args = '[REDACTED]';
    if ('raw_result' in safe.metadata) safe.metadata.raw_result = '[REDACTED]';
    if ('prompt' in safe.metadata) safe.metadata.prompt = '[REDACTED]';
    if ('response' in safe.metadata) safe.metadata.response = '[REDACTED]';
  }
  return safe;
}

module.exports = {
  redactText,
  redactObject,
  redactToolEvent
};
