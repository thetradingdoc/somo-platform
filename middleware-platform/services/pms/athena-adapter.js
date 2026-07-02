'use strict';

const { BasePmsAdapter } = require('./pms-adapter');
const { PmsError, PMS_ERROR } = require('./pms-errors');
const { AthenaClient } = require('./athena-client');
const { resolveAthenaConfig, hasAthenaCredentials } = require('./athena-config');
const {
  upsertShadowAppointment,
  resolveLocalPatientId,
  resolveAthenaAppointmentId,
  ensureLocalPatient,
  formatDisplayTime
} = require('./athena-shadow');

function toAthenaDate(isoOrSlash) {
  if (!isoOrSlash) return null;
  const s = String(isoOrSlash);
  if (s.includes('/')) return s;
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${m}/${d}/${y}`;
}

function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/\D/g, '').slice(-10);
}

function mapAthenaPatient(row, clinicId, localId = null) {
  const first = row.firstname || '';
  const last = row.lastname || '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  const athenaId = String(row.patientid || row.id || '');
  const local = localId || resolveLocalPatientId(clinicId, athenaId) || athenaId;
  return {
    id: local,
    external_id: athenaId,
    first_name: first,
    last_name: last,
    full_name: full,
    phone: row.mobilephone || row.homephone || null,
    email: row.email || null,
    dob: row.dob || null,
    is_returning: true,
    match_confidence: 'high'
  };
}

class AthenaAdapter extends BasePmsAdapter {
  constructor(clinicId, settings = {}) {
    super(clinicId, settings);
    this.pmsType = 'athena';
    this.config = resolveAthenaConfig(settings, clinicId);
    this.client = new AthenaClient(settings, clinicId);
  }

  _requireCreds() {
    if (!hasAthenaCredentials(this.config)) {
      throw new PmsError(
        PMS_ERROR.NOT_CONFIGURED,
        'Athena requires client_id, client_secret, and practice_id'
      );
    }
  }

  async healthCheck() {
    if (!hasAthenaCredentials(this.config)) {
      return {
        ok: false,
        pms_type: 'athena',
        message: 'Athena credentials incomplete (client_id, client_secret, practice_id)'
      };
    }
    try {
      const data = await this.client.get('/practiceinfo', { practiceid: this.config.practice_id });
      const name = data?.name || data?.[0]?.name || 'Athena preview';
      return { ok: true, pms_type: 'athena', message: `Connected: ${name}` };
    } catch (e) {
      return { ok: false, pms_type: 'athena', message: e.message };
    }
  }

  async lookupPatient({ phone, email, dob, patient_id, name } = {}) {
    this._requireCreds();
    const params = { limit: 5 };
    const mobile = normalizePhone(phone);
    if (mobile) params.mobilephone = mobile;
    if (email) params.email = email;
    if (dob) params.dob = toAthenaDate(dob) || dob;
    if (name) params.firstname = String(name).split(' ')[0];

    if (patient_id) {
      const localAthena = resolveAthenaAppointmentId(patient_id);
      const ext = resolveLocalPatientId(this.clinicId, localAthena);
      if (ext) {
        return mapAthenaPatient({ patientid: localAthena, firstname: '', lastname: '' }, this.clinicId, patient_id);
      }
    }

    if (!mobile && !email && !dob && !name) return null;

    const data = await this.client.get('/patients/search', params);
    const patients = data?.patients || data || [];
    const list = Array.isArray(patients) ? patients : [patients].filter(Boolean);
    if (list.length > 1) {
      throw new PmsError(PMS_ERROR.AMBIGUOUS_MATCH, 'Multiple Athena patients match');
    }
    if (!list.length) return null;

    const row = list[0];
    const localPatientId = ensureLocalPatient({
      clinicId: this.clinicId,
      athenaPatient: row,
      phone: mobile,
      email
    });
    return mapAthenaPatient(row, this.clinicId, localPatientId);
  }

  async _resolveAppointmentTypeId(appointmentType) {
    if (this.config.default_appointmenttype_id) {
      return String(this.config.default_appointmenttype_id);
    }
    const data = await this.client.get('/appointmenttypes', {
      departmentid: this.config.department_id
    });
    const types = data?.appointmenttypes || data || [];
    const list = Array.isArray(types) ? types : [types].filter(Boolean);
    const want = String(appointmentType || 'General Consult').toLowerCase();
    const match =
      list.find((t) => String(t.name || '').toLowerCase().includes(want)) ||
      list.find((t) => String(t.patientdisplayname || '').toLowerCase().includes('office')) ||
      list[0];
    return match ? String(match.appointmenttypeid || match.id) : null;
  }

  async getSchedule({
    date,
    appointment_type = null,
    timezone = 'America/New_York'
  } = {}) {
    this._requireCreds();
    const departmentId = this.config.department_id;
    if (!departmentId) {
      throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Athena department_id required for scheduling');
    }
    const athenaDate = toAthenaDate(date);
    const typeId = await this._resolveAppointmentTypeId(appointment_type);

    const data = await this.client.get('/appointments/open', {
      departmentid: departmentId,
      startdate: athenaDate,
      enddate: athenaDate,
      ...(typeId ? { appointmenttypeid: typeId } : {}),
      limit: 50
    });

    const appointments = data?.appointments || data || [];
    const list = Array.isArray(appointments) ? appointments : [appointments].filter(Boolean);
    const slots = list
      .map((a) => {
        const t = a.starttime || a.time || '';
        return formatDisplayTime(t) || t;
      })
      .filter(Boolean);

    return {
      success: true,
      date,
      timezone,
      available_slots: slots,
      slots,
      raw_count: list.length
    };
  }

  async bookAppointment(data) {
    this._requireCreds();
    const departmentId = this.config.department_id;
    if (!departmentId) {
      throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Athena department_id required');
    }

    let athenaPatientId = data.athena_patient_id || null;
    if (!athenaPatientId && data.patient_id) {
      const ext = resolveLocalPatientId(this.clinicId, data.patient_id);
      if (ext) {
        const mapping = require('../../database').getPatientExternalIds?.(ext) || [];
        const athenaMap = mapping.find((m) => m.source_system === 'athena');
        athenaPatientId = athenaMap?.external_patient_id || null;
      }
    }
    if (!athenaPatientId && (data.patient_phone || data.patient_name)) {
      const found = await this.lookupPatient({
        phone: data.patient_phone,
        name: data.patient_name,
        email: data.patient_email
      });
      if (found?.external_id) athenaPatientId = found.external_id;
    }
    if (!athenaPatientId) {
      return { success: false, error: 'Athena patient_id required — lookup failed' };
    }

    const typeId = await this._resolveAppointmentTypeId(data.appointment_type);
    const athenaDate = toAthenaDate(data.date);
    const timeMatch = String(data.time || '').match(/(\d{1,2}):(\d{2})/);
    let hour = timeMatch ? parseInt(timeMatch[1], 10) : 9;
    const min = timeMatch ? timeMatch[2] : '00';
    if (String(data.time).toUpperCase().includes('PM') && hour < 12) hour += 12;
    if (String(data.time).toUpperCase().includes('AM') && hour === 12) hour = 0;
    const appointmenttime = `${String(hour).padStart(2, '0')}:${min}`;

    const bookRes = await this.client.post('/appointments', {
      appointmenttypeid: typeId,
      departmentid: departmentId,
      patientid: athenaPatientId,
      appointmentdate: athenaDate,
      appointmenttime
    });

    const athenaApptId =
      bookRes?.appointmentid ||
      bookRes?.[0]?.appointmentid ||
      bookRes?.appointmentids?.[0] ||
      null;

    if (!athenaApptId) {
      return { success: false, error: 'Athena book returned no appointment id', raw: bookRes };
    }

    const localPatientId =
      data.patient_id || ensureLocalPatient({
        clinicId: this.clinicId,
        athenaPatient: { patientid: athenaPatientId },
        phone: data.patient_phone,
        email: data.patient_email
      });

    const shadow = await upsertShadowAppointment({
      clinicId: this.clinicId,
      athenaAppointmentId: athenaApptId,
      patientId: localPatientId,
      patientName: data.patient_name,
      patientPhone: data.patient_phone,
      patientEmail: data.patient_email,
      appointmentType: data.appointment_type,
      date: data.date,
      time: appointmenttime,
      timezone: data.timezone || 'America/New_York'
    });

    return {
      success: true,
      appointment: shadow,
      appointment_id: shadow.id,
      pms_external_id: String(athenaApptId),
      pms_source: 'athena'
    };
  }

  async rescheduleAppointment(appointmentId, newDate, newTime, reason) {
    this._requireCreds();
    const externalId = resolveAthenaAppointmentId(appointmentId);
    const athenaDate = toAthenaDate(newDate);
    const timeMatch = String(newTime || '').match(/(\d{1,2}):(\d{2})/);
    let hour = timeMatch ? parseInt(timeMatch[1], 10) : 9;
    const min = timeMatch ? timeMatch[2] : '00';
    if (String(newTime).toUpperCase().includes('PM') && hour < 12) hour += 12;
    const appointmenttime = `${String(hour).padStart(2, '0')}:${min}`;

    await this.client.put(`/appointments/${externalId}`, {
      appointmentdate: athenaDate,
      appointmenttime,
      ...(reason ? { cancellationreason: reason } : {})
    });

    const db = require('../../database');
    if (db.db) {
      db.db.prepare(`
        UPDATE appointments SET date = ?, time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? OR pms_external_id = ?
      `).run(newDate, newTime, appointmentId, String(externalId));
    }

    return { success: true, appointment_id: appointmentId, pms_external_id: externalId };
  }

  async cancelAppointment(appointmentId, reason) {
    this._requireCreds();
    const externalId = resolveAthenaAppointmentId(appointmentId);
    await this.client.put(`/appointments/${externalId}/cancel`, {
      cancellationreason: reason || 'Patient requested'
    });

    const db = require('../../database');
    if (db.db) {
      db.db.prepare(`
        UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? OR pms_external_id = ?
      `).run(appointmentId, String(externalId));
    }

    return { success: true, appointment_id: appointmentId };
  }

  async writeNote({ appointment_id, patient_id, text, note_type = 'front_desk' } = {}) {
    this._requireCreds();
    const externalPatientId =
      patient_id && resolveLocalPatientId(this.clinicId, patient_id)
        ? null
        : patient_id;

    let athenaPatientId = externalPatientId;
    if (patient_id && !athenaPatientId) {
      const db = require('../../database');
      const mappings = db.getPatientExternalIds?.(patient_id) || [];
      const m = mappings.find((x) => x.source_system === 'athena');
      athenaPatientId = m?.external_patient_id || null;
    }

    if (!athenaPatientId) {
      return { success: true, stored: 'log_only', note: text, message: 'No Athena patient id for note' };
    }

    const noteText = `[${note_type}] ${text}`;
    try {
      await this.client.post(
        `/patients/${athenaPatientId}/documents`,
        {
          departmentid: this.config.department_id,
          documentsubclass: 'ADMIN',
          documenttypeid: 1,
          internalnote: noteText
        },
        true
      );
      return { success: true, patient_id: athenaPatientId, note: noteText };
    } catch (e) {
      return { success: true, stored: 'log_only', note: noteText, warning: e.message };
    }
  }

  async getNextAppointment(patientId) {
    this._requireCreds();
    const db = require('../../database');
    const mappings = db.getPatientExternalIds?.(patientId) || [];
    const m = mappings.find((x) => x.source_system === 'athena');
    const athenaPatientId = m?.external_patient_id;
    if (!athenaPatientId) return null;

    const today = toAthenaDate(new Date().toISOString().slice(0, 10));
    const data = await this.client.get('/appointments/booked', {
      patientid: athenaPatientId,
      startdate: today,
      enddate: today,
      showpast: false,
      limit: 5
    });

    const appointments = data?.appointments || data || [];
    const list = Array.isArray(appointments) ? appointments : [appointments].filter(Boolean);
    const upcoming = list[0];
    if (!upcoming) return null;

    return {
      id: upcoming.appointmentid,
      external_id: String(upcoming.appointmentid),
      patient_id: patientId,
      date: upcoming.date || upcoming.appointmentdate,
      time: formatDisplayTime(upcoming.starttime || upcoming.appointmenttime),
      status: upcoming.status || 'scheduled',
      appointment_type: upcoming.appointmenttype || null
    };
  }
}

module.exports = { AthenaAdapter };
