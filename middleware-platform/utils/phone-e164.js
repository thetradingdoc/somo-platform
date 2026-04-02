'use strict';

/**
 * Normalize phone input to E.164: one leading "+" then digits only (8–15 total digits per ITU-T E.164).
 * Aligns "1…", "+1…", "(555) …", and "555…" (10-digit US) to the same stored form (+1…).
 *
 * @param {string|null|undefined} input
 * @returns {string} E.164 string or '' if unusable
 */
function normalizeToE164(input) {
  if (input == null) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 8 || digits.length > 15) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return `+${digits}`;
}

/**
 * @param {string|null|undefined} s
 * @returns {boolean}
 */
function isLikelyE164(s) {
  return /^\+[1-9]\d{7,14}$/.test(String(s || '').trim());
}

module.exports = {
  normalizeToE164,
  isLikelyE164
};
