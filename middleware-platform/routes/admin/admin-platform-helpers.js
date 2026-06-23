'use strict';

/** Mask helpers extracted from admin-platform.js (Phase 6.5). */
function maskEmail(email) {
  const e = String(email || '').trim();
  if (!e || !e.includes('@')) return '';
  return e.replace(/(^.).+(@.+$)/, '$1***$2');
}

function maskPhone(phone) {
  const p = String(phone || '').trim();
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `(***) ***-${digits.slice(-4)}`;
}

module.exports = { maskEmail, maskPhone };
