'use strict';

const EVENT_LABELS = {
  call_opener_used: 'Opener played — AI disclosure given',
  eligibility_complete: 'Insurance verified',
  internal_eligibility_complete: 'Insurance verified',
  eligibility_checked: 'Insurance check completed',
  copay_quoted: 'Copay quoted',
  copay_quote_spoken: 'Copay quoted on call',
  payment_link_sent: 'Payment link sent',
  booking_outcome: 'Appointment booked',
  pms_sync_pending: 'Synced to daily digest — pending PMS entry',
  appointment_created: 'Appointment booked'
};

function parsePayload(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return {};
  }
}

function labelForEvent(eventType, payload) {
  if (EVENT_LABELS[eventType]) return EVENT_LABELS[eventType];
  if (String(eventType || '').startsWith('eligibility')) return 'Insurance check';
  if (String(eventType || '').includes('copay')) return 'Copay quoted';
  if (String(eventType || '').includes('payment')) return 'Payment link sent';
  if (payload?.tool_name === 'schedule_appointment') return 'Appointment booked';
  return null;
}

/**
 * Map kelly_call_events to patient-friendly timeline rows.
 * @param {object[]} events - rows with event_type, created_at, payload_json
 */
function buildCallTimeline(events = []) {
  const rows = [];
  const seen = new Set();

  for (const ev of events) {
    const payload = parsePayload(ev.payload_json);
    const label = labelForEvent(ev.event_type, payload);
    if (!label) continue;
    const key = `${ev.event_type}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      at: ev.created_at,
      event_type: ev.event_type,
      label,
      detail: payload.payer_name || payload.amount || payload.appointment_type || null
    });
  }

  return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

module.exports = {
  buildCallTimeline,
  labelForEvent,
  EVENT_LABELS
};
