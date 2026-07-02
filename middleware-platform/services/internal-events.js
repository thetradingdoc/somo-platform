'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

function emitInternalEvent({ eventType, sessionId, clinicId, customerId, payload } = {}) {
  if (!db.db || !eventType) return null;
  const id = `evt_${uuidv4()}`;
  db.db
    .prepare(
      `
      INSERT INTO internal_events (id, event_type, session_id, clinic_id, customer_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      id,
      eventType,
      sessionId || null,
      clinicId || null,
      customerId || null,
      payload ? JSON.stringify(payload) : null
    );
  return id;
}

function onEligibilityComplete(payload = {}) {
  return emitInternalEvent({
    eventType: 'eligibility_complete',
    sessionId: payload.sessionId || payload.session_id,
    clinicId: payload.clinicId || payload.clinic_id,
    customerId: payload.customerId || payload.customer_id,
    payload
  });
}

module.exports = { emitInternalEvent, onEligibilityComplete };
