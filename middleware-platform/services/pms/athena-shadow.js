'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');

function toIsoDateParts(dateStr, timeStr, timezone = 'America/New_York') {
  const d = dateStr || '';
  const t = timeStr || '09:00';
  const m = String(t).match(/(\d{1,2}):(\d{2})/);
  const hour = m ? parseInt(m[1], 10) : 9;
  const min = m ? parseInt(m[2], 10) : 0;
  const isoDate = d.includes('/') ? d : d;
  let ymd = isoDate;
  if (isoDate.includes('/')) {
    const [mm, dd, yyyy] = isoDate.split('/');
    ymd = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const start = `${ymd}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
  return {
    date: ymd,
    time: String(t),
    start_time: start,
    end_time: start,
    timezone
  };
}

function formatDisplayTime(time24) {
  const m = String(time24).match(/(\d{1,2}):(\d{2})/);
  if (!m) return time24;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

async function upsertShadowAppointment({
  clinicId,
  athenaAppointmentId,
  patientId,
  patientName,
  patientPhone,
  patientEmail,
  appointmentType,
  date,
  time,
  timezone,
  status = 'scheduled'
}) {
  const parts = toIsoDateParts(date, time, timezone);
  const displayTime = formatDisplayTime(time);
  const localId = `appt-athena-${athenaAppointmentId}`;

  const existing = db.db?.prepare('SELECT id FROM appointments WHERE id = ? OR pms_external_id = ?').get(
    localId,
    String(athenaAppointmentId)
  );

  const row = {
    id: existing?.id || localId,
    clinic_id: clinicId,
    patient_id: patientId || null,
    patient_name: patientName || 'Patient',
    patient_phone: patientPhone || '',
    patient_email: patientEmail || '',
    appointment_type: appointmentType || 'General Consult',
    date: parts.date,
    time: displayTime,
    start_time: parts.start_time,
    end_time: parts.end_time,
    duration_minutes: 30,
    provider: 'Athena',
    status,
    notes: '',
    calendar_event_id: null,
    calendar_link: null,
    video_room_name: null,
    timezone: parts.timezone,
    pms_source: 'athena',
    pms_external_id: String(athenaAppointmentId),
    pms_sync_status: 'synced',
    created_at: new Date().toISOString()
  };

  if (existing?.id) {
    db.db.prepare(`
      UPDATE appointments SET
        patient_id = ?, patient_name = ?, patient_phone = ?, patient_email = ?,
        appointment_type = ?, date = ?, time = ?, start_time = ?, end_time = ?,
        status = ?, pms_source = 'athena', pms_external_id = ?, pms_sync_status = 'synced',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      row.patient_id,
      row.patient_name,
      row.patient_phone,
      row.patient_email,
      row.appointment_type,
      row.date,
      row.time,
      row.start_time,
      row.end_time,
      row.status,
      row.pms_external_id,
      existing.id
    );
    return { ...row, id: existing.id };
  }

  await db.createAppointment(row);
  const { setAppointmentPmsFields } = require('./pms-store');
  setAppointmentPmsFields(row.id, {
    pms_source: 'athena',
    pms_external_id: String(athenaAppointmentId),
    pms_sync_status: 'synced'
  });
  return row;
}

function linkPatientExternalId({ patientId, clinicId, athenaPatientId, mrn = null }) {
  if (!patientId || !athenaPatientId || !db.upsertPatientExternalId) return null;
  return db.upsertPatientExternalId({
    patient_id: patientId,
    source_system: 'athena',
    tenant_id: String(clinicId),
    external_patient_id: String(athenaPatientId),
    mrn
  });
}

function resolveLocalPatientId(clinicId, athenaPatientId) {
  if (!athenaPatientId || !db.getPatientByExternalId) return null;
  const row = db.getPatientByExternalId('athena', String(clinicId), String(athenaPatientId));
  return row?.resource_id || null;
}

function resolveAthenaAppointmentId(localAppointmentId) {
  if (!localAppointmentId || !db.db) return localAppointmentId;
  const row = db.db.prepare('SELECT pms_external_id FROM appointments WHERE id = ?').get(localAppointmentId);
  return row?.pms_external_id || localAppointmentId;
}

function ensureLocalPatient({ clinicId, athenaPatient, phone, email }) {
  const existingId = resolveLocalPatientId(clinicId, athenaPatient.patientid || athenaPatient.id);
  if (existingId) return existingId;

  const patientId = `patient-athena-${athenaPatient.patientid || athenaPatient.id || uuidv4()}`;
  const first = athenaPatient.firstname || '';
  const last = athenaPatient.lastname || '';
  const full = [first, last].filter(Boolean).join(' ').trim() || 'Patient';

  if (db.db) {
    try {
      db.db.prepare(`
        INSERT OR IGNORE INTO fhir_patients (resource_id, clinic_id, name, resource_data, is_deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        patientId,
        clinicId,
        full,
        JSON.stringify({
          resourceType: 'Patient',
          id: patientId,
          name: [{ given: first ? [first] : [], family: last }],
          birthDate: athenaPatient.dob || null,
          telecom: [
            ...(phone ? [{ system: 'phone', value: phone }] : []),
            ...(email ? [{ system: 'email', value: email }] : [])
          ]
        })
      );
    } catch (_) {}
  }

  linkPatientExternalId({
    patientId,
    clinicId,
    athenaPatientId: athenaPatient.patientid || athenaPatient.id,
    mrn: athenaPatient.patientid || null
  });

  return patientId;
}

module.exports = {
  upsertShadowAppointment,
  linkPatientExternalId,
  resolveLocalPatientId,
  resolveAthenaAppointmentId,
  ensureLocalPatient,
  toIsoDateParts,
  formatDisplayTime
};
