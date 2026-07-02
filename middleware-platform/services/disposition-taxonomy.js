'use strict';

const DISPOSITIONS = [
  'booked',
  'rescheduled',
  'cancelled',
  'insurance_verified',
  'copay_collected',
  'copay_pending',
  'handoff',
  'message_taken',
  'no_answer',
  'wrong_number',
  'spam',
  'stedi_down',
  'pms_sync_pending'
];

function normalizeDisposition(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (DISPOSITIONS.includes(key)) return key;
  if (/book|schedul/.test(key)) return 'booked';
  if (/insur|elig/.test(key)) return 'insurance_verified';
  if (/copay|pay/.test(key)) return 'copay_pending';
  if (/transfer|handoff|escalat/.test(key)) return 'handoff';
  return 'message_taken';
}

function recordCallDisposition({ sessionId, callId, disposition, meta } = {}) {
  console.log(
    JSON.stringify({
      component: 'call_disposition',
      session_id: sessionId,
      call_id: callId,
      disposition: normalizeDisposition(disposition),
      meta: meta || null
    })
  );
  return normalizeDisposition(disposition);
}

module.exports = { DISPOSITIONS, normalizeDisposition, recordCallDisposition };
