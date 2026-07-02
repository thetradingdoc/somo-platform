'use strict';

const db = require('../../database');
const BookingService = require('../booking-service');
const { BasePmsAdapter } = require('./pms-adapter');
const { PmsError, PMS_ERROR } = require('./pms-errors');

class SomoAdapter extends BasePmsAdapter {
  constructor(clinicId, settings = {}) {
    super(clinicId, settings);
    this.pmsType = 'somo';
  }

  async healthCheck() {
    return {
      ok: true,
      pms_type: 'somo',
      message: 'Somo calendar is system of record'
    };
  }

  async lookupPatient({ phone, email, dob, patient_id, name } = {}) {
    if (patient_id && db.db) {
      const row = db.db.prepare(`
        SELECT resource_id, resource_data, name FROM fhir_patients WHERE resource_id = ? LIMIT 1
      `).get(patient_id);
      if (row) return this._mapFhirPatient(row, 'high');
    }
    if (phone && db.getFHIRPatientByPhone) {
      const matches = db.getFHIRPatientByPhone(phone, {
        clinicId: this.clinicId,
        requireClinicScope: true,
        returnAll: true
      });
      if (Array.isArray(matches)) {
        if (matches.length > 1) {
          throw new PmsError(PMS_ERROR.AMBIGUOUS_MATCH, 'Multiple patients match phone');
        }
        if (matches.length === 1) return this._mapFhirPatient(matches[0], 'high');
      } else if (matches) {
        return this._mapFhirPatient(matches, 'high');
      }
    }
    if (email && db.db) {
      const row = db.db.prepare(`
        SELECT resource_id, resource_data, name FROM fhir_patients
        WHERE lower(json_extract(resource_data, '$.telecom[0].value')) = lower(?)
        LIMIT 2
      `).all(email);
      if (row.length > 1) {
        throw new PmsError(PMS_ERROR.AMBIGUOUS_MATCH, 'Multiple patients match email');
      }
      if (row.length === 1) return this._mapFhirPatient(row[0], 'medium');
    }
    if (name && phone && db.db) {
      const rows = db.db.prepare(`
        SELECT resource_id, resource_data, name FROM fhir_patients
        WHERE clinic_id = ? AND name LIKE ?
        LIMIT 3
      `).all(this.clinicId, `%${name}%`);
      if (rows.length > 1) {
        throw new PmsError(PMS_ERROR.AMBIGUOUS_MATCH, 'Ambiguous name match without phone confirmation');
      }
      if (rows.length === 1) return this._mapFhirPatient(rows[0], 'medium');
    }
    return null;
  }

  _mapFhirPatient(row, confidence = 'medium') {
    const data = row.resource_data && typeof row.resource_data === 'object'
      ? row.resource_data
      : (typeof row.resource_data === 'string' ? JSON.parse(row.resource_data || '{}') : {});
    const n = data?.name?.[0];
    const first = n?.given?.join(' ') || '';
    const last = n?.family || '';
    const full = [first, last].filter(Boolean).join(' ').trim() || row.name || '';
    const phone = data?.telecom?.find((t) => t.system === 'phone')?.value || null;
    const email = data?.telecom?.find((t) => t.system === 'email')?.value || null;
    const dob = data?.birthDate || null;
    return {
      id: row.resource_id,
      external_id: row.resource_id,
      first_name: first,
      last_name: last,
      full_name: full,
      phone,
      email,
      dob,
      is_returning: true,
      match_confidence: confidence
    };
  }

  async getSchedule({
    date,
    provider = null,
    appointment_type = null,
    timezone = null,
    practitioner_id = null
  } = {}) {
    const result = await BookingService.getAvailableSlots(
      date,
      provider,
      appointment_type,
      timezone || 'America/New_York',
      this.clinicId,
      practitioner_id
    );
    return result;
  }

  async bookAppointment(data) {
    const mirrorGoogle = this.settings?.mirror_google !== false;
    const result = await BookingService.scheduleAppointment({
      ...data,
      clinic_id: data.clinic_id || this.clinicId,
      skip_google_mirror: !mirrorGoogle
    });
    if (result?.success && result.appointment?.id) {
      result.pms_external_id = result.appointment.id;
      result.pms_source = 'somo';
    }
    return result;
  }

  async rescheduleAppointment(appointmentId, newDate, newTime, reason, timezone) {
    return BookingService.rescheduleAppointment(
      appointmentId,
      newDate,
      newTime,
      reason,
      timezone,
      this.clinicId
    );
  }

  async cancelAppointment(appointmentId, reason) {
    return BookingService.cancelAppointment(appointmentId, reason, this.clinicId);
  }

  async writeNote({ appointment_id, patient_id, text, note_type = 'front_desk' } = {}) {
    if (!db.db) return { success: false, error: 'Database unavailable' };
    const noteLine = `[${note_type}] ${text}`;
    if (appointment_id) {
      const appt = db.db.prepare('SELECT notes FROM appointments WHERE id = ?').get(appointment_id);
      const merged = appt?.notes ? `${appt.notes}\n${noteLine}` : noteLine;
      db.db.prepare(`
        UPDATE appointments SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(merged, appointment_id);
      return { success: true, appointment_id, note: noteLine };
    }
    if (patient_id) {
      return { success: true, patient_id, note: noteLine, stored: 'log_only' };
    }
    return { success: false, error: 'appointment_id or patient_id required' };
  }

  async getNextAppointment(patientId) {
    if (!patientId || !db.db) return null;
    const row = db.db.prepare(`
      SELECT * FROM appointments
      WHERE patient_id = ? AND clinic_id = ?
        AND status IN ('scheduled', 'confirmed')
        AND datetime(start_time) >= datetime('now')
        AND (deleted_at IS NULL OR deleted_at = '')
      ORDER BY datetime(start_time) ASC
      LIMIT 1
    `).get(patientId, this.clinicId);
    if (!row) return null;
    return {
      id: row.id,
      external_id: row.pms_external_id || row.id,
      patient_id: row.patient_id,
      patient_name: row.patient_name,
      date: row.date,
      time: row.time,
      status: row.status,
      appointment_type: row.appointment_type
    };
  }
}

module.exports = { SomoAdapter };
