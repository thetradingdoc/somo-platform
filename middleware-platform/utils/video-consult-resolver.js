/**
 * Video Consult Entity Resolver
 * vc-13: Single source of truth for room_id ↔ appointment_id ↔ encounter_id mapping.
 * Used by case report, UI, and claims to avoid silent mismatches.
 */

const db = require('../database');

/**
 * Resolve any identifier to the full mapping.
 * @param {Object} opts - { room_id?, appointment_id?, encounter_id? }
 * @returns {Promise<{room_id, appointment_id, encounter_id, patient_id, clinic_id}|null>}
 */
async function resolveVideoConsultIds(opts = {}) {
  const { room_id, appointment_id, encounter_id } = opts;
  if (!room_id && !appointment_id && !encounter_id) return null;

  let appointmentId = appointment_id || null;
  let roomId = room_id || null;
  let encounterId = encounter_id || null;

  // From room_id (e.g. appt-xxx, health-uuid, or case-CR-xxx)
  if (roomId) {
    if (roomId.startsWith('health-')) {
      const sessionId = roomId.replace(/^health-/, '');
      return {
        room_id: roomId,
        appointment_id: null,
        encounter_id: sessionId,
        patient_id: null,
        clinic_id: null,
        health_session_id: sessionId
      };
    }
    if (roomId.startsWith('appt-')) {
      appointmentId = appointmentId || roomId.replace(/^appt-/, '');
      encounterId = encounterId || appointmentId; // Video consult: encounter_id = appointment_id
    } else if (roomId.startsWith('case-')) {
      const caseNumber = roomId.replace(/^case-/, '');
      if (db.getAppointmentIdFromCaseNumber) {
        appointmentId = appointmentId || db.getAppointmentIdFromCaseNumber(caseNumber);
        encounterId = encounterId || appointmentId;
      }
    }
  }

  // From appointment_id
  if (appointmentId && !roomId) {
    roomId = `appt-${appointmentId}`;
    encounterId = encounterId || appointmentId;
  }

  // From encounter_id (may need to reverse-lookup room from session or fhir_encounters)
  if (encounterId && !appointmentId) {
    try {
      // Check video_consult_sessions for room
      const session = db.db?.prepare?.(
        'SELECT room_id, appointment_id FROM video_consult_sessions WHERE encounter_id = ? OR room_id = ? LIMIT 1'
      )?.get(encounterId, `appt-${encounterId}`);
      if (session) {
        roomId = roomId || session.room_id;
        appointmentId = appointmentId || session.appointment_id;
      }
      // FHIR encounters for video use resource_id; often = appointment_id when from migration
      if (!appointmentId && db.getFHIREncounter) {
        const enc = db.getFHIREncounter(encounterId);
        if (enc?.resource_data) {
          const callId = typeof enc.resource_data === 'string'
            ? JSON.parse(enc.resource_data)?.extension?.find?.(e => e.url?.includes('voice-call-id'))?.valueString
            : enc.resource_data?.extension?.find?.(e => e.url?.includes('voice-call-id'))?.valueString;
          if (callId && callId.startsWith('appt-')) {
            appointmentId = callId.replace(/^appt-/, '');
            roomId = callId;
          }
        }
      }
      if (!appointmentId) appointmentId = encounterId; // Fallback: treat encounter_id as appointment_id
      if (!roomId) roomId = `appt-${appointmentId}`;
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[video-consult-resolver] encounter lookup:', e.message);
      appointmentId = appointmentId || encounterId;
      roomId = roomId || `appt-${encounterId}`;
    }
  }

  if (!appointmentId && !roomId) return null;

  let patientId = null;
  let clinicId = null;
  try {
    const appt = await db.getAppointment?.(appointmentId || roomId?.replace?.(/^appt-/, ''));
    if (appt) {
      patientId = appt.patient_id || appt.customer_id;
      clinicId = appt.clinic_id;
    }
  } catch (_) {}

  return {
    room_id: roomId || `appt-${appointmentId}`,
    appointment_id: appointmentId,
    encounter_id: encounterId || appointmentId,
    patient_id: patientId,
    clinic_id: clinicId
  };
}

module.exports = {
  resolveVideoConsultIds
};
