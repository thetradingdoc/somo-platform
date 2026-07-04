'use strict';

const CONFIRM_PATTERNS = [
  /\b(yes|yeah|yep|yup|correct|right|sure|ok|okay|confirm|book it|works for me|that works|sounds good|please book|go ahead)\b/i,
  /\b(sí|si|vale|correcto|confirmo|reservar|de acuerdo|por favor)\b/i,
  /(?:^|[\s,.!?])(好|可以|确认|是的|行)(?:$|[\s,.!?])/,
  /(?:^|[\s,.!?])(да|хорошо|подходит|верно|правильно|конечно|окей|ок)(?:$|[\s,.!?])/i
];

const LOCALIZED_BOOK_CONFIRM_RE =
  /book|confirm|works|yes|please|email|@|sí|si\b|por favor|reservar|хорошо|подходит|да|martes|tarde|вторник|днём|днем|funciona|me funciona|me viene bien/i;

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

function passesLocalizedBookConfirm(message) {
  return isConfirmatoryUtterance(message) || LOCALIZED_BOOK_CONFIRM_RE.test(String(message || ''));
}

module.exports = {
  isConfirmatoryUtterance,
  passesLocalizedBookConfirm,
  CONFIRM_PATTERNS,
  DENY_PATTERNS,
  LOCALIZED_BOOK_CONFIRM_RE
};
