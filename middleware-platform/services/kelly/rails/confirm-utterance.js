'use strict';

const CONFIRM_PATTERNS = [
  /\b(yes|yeah|yep|yup|correct|right|sure|ok|okay|confirm|book it|works for me|that works|sounds good|please book|go ahead)\b/i,
  /\b(sí|si|vale|correcto|confirmo|reservar|de acuerdo|por favor)\b/i,
  /\b(好|可以|确认|是的|行)\b/
];

const DENY_PATTERNS = [
  /\b(no|nope|don't|do not|cancel that|not that|wrong)\b/i,
  /\b(no gracias|no quiero)\b/i
];

function isConfirmatoryUtterance(message) {
  const msg = String(message || '').trim();
  if (!msg) return false;
  if (DENY_PATTERNS.some((r) => r.test(msg))) return false;
  if (/[\w.+-]+@[\w.-]+\.\w+/.test(msg)) return true;
  return CONFIRM_PATTERNS.some((r) => r.test(msg));
}

module.exports = { isConfirmatoryUtterance, CONFIRM_PATTERNS, DENY_PATTERNS };
