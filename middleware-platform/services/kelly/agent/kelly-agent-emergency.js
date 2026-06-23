'use strict';

const db = require('../../../database');

function persistEmergencyFlag(sessionId, patientId, callerPhone, channel, assessment) {
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (db.upsertPatientEmergencyFlag) {
      db.upsertPatientEmergencyFlag({
        patient_id: patientId || null,
        phone: callerPhone || null,
        source: channel,
        call_id: sessionId,
        expires_at: expiresAt,
        metadata: { red_flags: assessment.redFlags || [], urgency: assessment.urgency || 'EMERGENT' },
      });
    }
  } catch (_) {}
}

module.exports = { persistEmergencyFlag };
