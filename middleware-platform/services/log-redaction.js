'use strict';

const PHI_KEYS = new Set([
  'member_id',
  'memberId',
  'subscriber_id',
  'group_number',
  'ssn',
  'date_of_birth',
  'dob',
  'birthDate',
  'patient_name',
  'full_name',
  'phone',
  'email',
  'response_data',
  'routing_payload_json'
]);

function redactValue(key, value) {
  if (value == null) return value;
  const k = String(key || '').toLowerCase();
  if (PHI_KEYS.has(key) || PHI_KEYS.has(k)) {
    const s = String(value);
    if (s.length <= 4) return '***';
    return `${s.slice(0, 2)}***${s.slice(-2)}`;
  }
  return value;
}

function redactForLog(obj, depth = 0) {
  if (obj == null || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactForLog(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v !== null) out[k] = redactForLog(v, depth + 1);
    else out[k] = redactValue(k, v);
  }
  return out;
}

function safeEligibilityLog(label, payload) {
  console.log(label, JSON.stringify(redactForLog(payload)));
}

module.exports = { redactForLog, safeEligibilityLog, PHI_KEYS };
