'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');

if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(__dirname, '..', '..', '..', 'middleware-dev.db');
}

const db = require('../../../database');
const { API_BASE } = require('./portal-auth.cjs');

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Seed a scheduled appointment for the provider's clinic (DB-first for reliable E2E).
 */
async function seedAppointmentViaApi(request, customer, overrides = {}) {
  const clinicRow = db.db
    .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1')
    .get(customer.merchant_id);
  const clinicId = clinicRow?.clinic_id || customer.clinic_id || 'clinic-default';
  const date = overrides.date || tomorrowIso();
  const time = overrides.time || `${String(8 + Math.floor(Math.random() * 10)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;
  const patientName = overrides.patient_name || 'E2E Test Patient';
  const id = overrides.id || `appt_e2e_${uuidv4().slice(0, 8)}`;
  const hh = String(time).split(':');
  const startIso = `${date}T${String(hh[0] || '10').padStart(2, '0')}:${String(hh[1] || '00').padStart(2, '0')}:00`;
  const endDate = new Date(startIso);
  endDate.setMinutes(endDate.getMinutes() + 30);

  const appointment = {
    id,
    clinic_id: clinicId,
    patient_name: patientName,
    patient_phone: overrides.patient_phone || '+15555550199',
    patient_email: overrides.patient_email || 'e2e-patient@somo.test',
    appointment_type: overrides.appointment_type || 'General Consult',
    date,
    time,
    status: overrides.status || 'scheduled',
    notes: overrides.notes || 'E2E fixture',
    provider: overrides.provider || 'E2E Provider',
    duration_minutes: 30,
    start_time: startIso,
    end_time: endDate.toISOString(),
    confirmation: id
  };

  try {
    const res = await request.post(`${API_BASE}/api/admin/appointments/create`, {
      data: {
        clinic_id: clinicId,
        patient_name: patientName,
        patient_phone: appointment.patient_phone,
        patient_email: appointment.patient_email,
        appointment_type: appointment.appointment_type,
        date,
        time,
        status: 'scheduled',
        notes: appointment.notes
      }
    });
    const body = await res.json();
    if (res.ok() && body.success && body.appointment) {
      return { ...body.appointment, clinic_id: clinicId, date, time };
    }
  } catch (_) {}

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (attempt > 0) {
        const slot = 8 * 60 + Math.floor(Math.random() * 540);
        const h = String(Math.floor(slot / 60)).padStart(2, '0');
        const m = String(slot % 60).padStart(2, '0');
        appointment.time = `${h}:${m}`;
        appointment.id = `appt_e2e_${uuidv4().slice(0, 8)}`;
        const startIso = `${date}T${appointment.time}:00`;
        const endDate = new Date(startIso);
        endDate.setMinutes(endDate.getMinutes() + 30);
        appointment.start_time = startIso;
        appointment.end_time = endDate.toISOString();
      }
      await db.createAppointment(appointment);
      break;
    } catch (e) {
      if (attempt === 4 || !String(e.message).includes('UNIQUE')) throw e;
    }
  }
  return { ...appointment, clinic_id: clinicId, date, time: appointment.time };
}

/**
 * Insert Kelly call event for activity feed tests.
 */
function seedKellyActivityEvent({ clinicId, sessionId, eventType = 'appointment_booked', payload = {} }) {
  const sid = sessionId || `e2e_call_${uuidv4().slice(0, 8)}`;
  db.insertKellyCallEvent({
    session_id: sid,
    call_id: sid,
    clinic_id: clinicId,
    event_type: eventType,
    payload_json: {
      patient_name: 'E2E Kelly Patient',
      appointment_type: 'General Consult',
      clinic_id: clinicId,
      ...payload
    }
  });
  return sid;
}

/**
 * Seed triage session for clinical-prep tests.
 */
function seedTriageForAppointment(sessionId, patientId, clinicId) {
  const id = sessionId || `triage_${uuidv4().slice(0, 8)}`;
  try {
    db.db
      .prepare(
        `INSERT OR REPLACE INTO triage_sessions (
          session_id, patient_id, clinic_id, quality, onset, severity, region, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(id, patientId || 'patient-e2e', clinicId, 'itchy rash', '2 days', '5', 'leg',);
  } catch (_) {
    // schema may vary — best effort
  }
  return id;
}

module.exports = {
  seedAppointmentViaApi,
  seedKellyActivityEvent,
  seedTriageForAppointment,
  tomorrowIso
};
