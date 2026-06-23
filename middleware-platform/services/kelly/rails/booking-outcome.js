'use strict';

const db = require('../../../database');

/**
 * Emit booking_outcome telemetry for TCC and ops dashboards.
 * @param {string} sessionId
 * @param {string} outcome - booked | no_availability | schedule_conflict | schedule_failed | provider_mismatch
 * @param {object} extra
 */
function emitBookingOutcome(sessionId, outcome, extra = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    db.insertKellyCallEvent?.({
      session_id: sid,
      event_type: 'booking_outcome',
      payload_json: JSON.stringify({
        outcome,
        error_code: extra.error_code || null,
        appointment_id: extra.appointment_id || null,
        date: extra.date || null,
        time: extra.time || null,
        gate: extra.gate || 'schedule',
        at: new Date().toISOString()
      })
    });
  } catch (_) {}
}

module.exports = { emitBookingOutcome };
