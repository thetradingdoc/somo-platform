'use strict';

const { BasePmsAdapter } = require('./pms-adapter');
const { PmsError, PMS_ERROR } = require('./pms-errors');
const { DentrixClient } = require('./dentrix-client');
const { resolveDentrixConfig, hasDentrixCredentials } = require('./dentrix-config');

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.slice(-10);
}

/** Strip filter grammar metacharacters so user input cannot inject extra clauses. */
function sanitizeDentrixFilterValue(value) {
  return String(value ?? '')
    .replace(/[,=<>~()]/g, '')
    .trim()
    .slice(0, 200);
}

function formatDisplayTime(isoOrTime) {
  if (!isoOrTime) return null;
  const s = String(isoOrTime);
  if (s.includes('T')) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }
  return s;
}

function dayBoundsIso(date) {
  const start = `${date}T00:00:00`;
  const end = `${date}T23:59:59`;
  return { start, end };
}

function defaultOpenSlots() {
  const slots = [];
  for (let hour = 9; hour <= 16; hour++) {
    for (const min of [0, 30]) {
      if (hour === 16 && min > 0) continue;
      const h12 = hour > 12 ? hour - 12 : hour;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      slots.push(`${h12}:${String(min).padStart(2, '0')} ${ampm}`);
    }
  }
  return slots;
}

function mapDentrixPatient(row, clinicId) {
  const first = row.firstName || row.first_name || '';
  const last = row.lastName || row.last_name || '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  const dentrixId = String(row.id || '');
  const phones = row.phones || row.phoneNumbers || [];
  const phone =
    (Array.isArray(phones) ? phones[0]?.number || phones[0]?.phone : null) ||
    row.primaryPhone ||
    row.mobilePhone ||
    null;
  return {
    id: dentrixId,
    external_id: dentrixId,
    first_name: first,
    last_name: last,
    full_name: full,
    phone,
    email: row.email || null,
    dob: row.dateOfBirth || row.birthDate || null,
    is_returning: true,
    match_confidence: 'high',
    clinic_id: clinicId
  };
}

class DentrixAdapter extends BasePmsAdapter {
  constructor(clinicId, settings = {}) {
    super(clinicId, settings);
    this.pmsType = 'dentrix';
    this.config = resolveDentrixConfig(settings, clinicId);
    this.client = new DentrixClient(settings, clinicId);
  }

  _requireCreds() {
    if (!hasDentrixCredentials(this.config)) {
      throw new PmsError(
        PMS_ERROR.NOT_CONFIGURED,
        'Dentrix requires client_id, client_secret, and organization_id (Henry Schein API Exchange)'
      );
    }
  }

  _blockedMessage() {
    return 'Dentrix Ascend credentials required — apply at Henry Schein API Exchange (Phase 3B)';
  }

  async healthCheck() {
    if (!hasDentrixCredentials(this.config)) {
      return {
        ok: false,
        pms_type: 'dentrix',
        message: this._blockedMessage()
      };
    }
    try {
      const linked = await this.client.get('/LinkedOrgs', null, { orgmapper: true });
      const orgs = linked?.organizations || [];
      const hasOrg = orgs.includes(this.config.organization_id);
      return {
        ok: hasOrg || orgs.length > 0,
        pms_type: 'dentrix',
        message: hasOrg
          ? `Connected: organization ${this.config.organization_id}`
          : `OAuth OK — ${orgs.length} linked org(s); verify DENTRIX_ORGANIZATION_ID`
      };
    } catch (e) {
      return { ok: false, pms_type: 'dentrix', message: e.message };
    }
  }

  async lookupPatient({ phone, email, dob, patient_id, name } = {}) {
    this._requireCreds();

    if (patient_id) {
      const raw = await this.client.get(`/v1/patients/${patient_id}`, {
        responseFields: 'firstName,lastName,email,phones,dateOfBirth'
      });
      const row = this.client.unwrap(raw);
      if (row?.id) return mapDentrixPatient(row, this.clinicId);
    }

    const filters = [];
    const mobile = normalizePhone(phone);
    if (mobile) {
      const safeMobile = sanitizeDentrixFilterValue(mobile);
      if (safeMobile) filters.push(`phones.number==${safeMobile}`);
    }
    if (email) {
      const safeEmail = sanitizeDentrixFilterValue(email);
      if (safeEmail) filters.push(`email==${safeEmail}`);
    }
    if (dob) {
      const safeDob = sanitizeDentrixFilterValue(dob);
      if (safeDob) filters.push(`dateOfBirth==${safeDob}`);
    }
    if (name) {
      const first = sanitizeDentrixFilterValue(String(name).split(' ')[0]);
      if (first) filters.push(`firstName~=${first}`);
    }
    if (!filters.length) return null;

    const raw = await this.client.get('/v1/patients', {
      filter: filters.join(','),
      pageSize: 5,
      responseFields: 'firstName,lastName,email,phones,dateOfBirth'
    });
    const rows = this.client.unwrap(raw) || [];
    const list = Array.isArray(rows) ? rows : [rows].filter(Boolean);
    if (list.length > 1) {
      throw new PmsError(PMS_ERROR.AMBIGUOUS_MATCH, 'Multiple Dentrix patients match');
    }
    if (!list.length) return null;
    return mapDentrixPatient(list[0], this.clinicId);
  }

  async getSchedule({ date, appointment_type = null, timezone = 'America/New_York' } = {}) {
    this._requireCreds();
    if (!date) {
      throw new PmsError(PMS_ERROR.LOOKUP_FAILED, 'date required for Dentrix schedule');
    }

    const { start, end } = dayBoundsIso(date);
    const bookedTimes = new Set();
    const raw = await this.client.get('/v1/appointments', {
      filter: `start>=${start},start<=${end}`,
      pageSize: 100,
      responseFields: 'start,status'
    });
    const rows = this.client.unwrap(raw) || [];
    const list = Array.isArray(rows) ? rows : [rows].filter(Boolean);
    for (const row of list) {
      const t = formatDisplayTime(row.start);
      if (t) bookedTimes.add(t);
    }

    const open = defaultOpenSlots().filter((slot) => !bookedTimes.has(slot));
    return {
      success: true,
      date,
      timezone,
      appointment_type,
      available_slots: open,
      slots: open,
      booked_count: bookedTimes.size
    };
  }

  async bookAppointment(data) {
    this._requireCreds();
    const locationId = this.config.location_id;
    if (!locationId) {
      return {
        success: false,
        error: 'Dentrix location_id required — run: npm run discover:dentrix-sandbox'
      };
    }

    let dentrixPatientId = data.dentrix_patient_id || data.external_patient_id || null;
    if (!dentrixPatientId && (data.patient_phone || data.patient_name)) {
      const found = await this.lookupPatient({
        phone: data.patient_phone,
        name: data.patient_name,
        email: data.patient_email
      });
      if (found?.external_id) dentrixPatientId = found.external_id;
    }
    if (!dentrixPatientId) {
      return { success: false, error: 'Dentrix patient_id required — lookup failed' };
    }

    const timeMatch = String(data.time || '').match(/(\d{1,2}):(\d{2})/);
    let hour = timeMatch ? parseInt(timeMatch[1], 10) : 9;
    const min = timeMatch ? timeMatch[2] : '00';
    if (String(data.time).toUpperCase().includes('PM') && hour < 12) hour += 12;
    if (String(data.time).toUpperCase().includes('AM') && hour === 12) hour = 0;
    const start = `${data.date}T${String(hour).padStart(2, '0')}:${min}:00`;

    const body = {
      patient: { id: String(dentrixPatientId) },
      location: { id: String(locationId) },
      start,
      ...(this.config.operatory_id ? { operatory: { id: String(this.config.operatory_id) } } : {}),
      ...(this.config.default_appointment_type_id
        ? { appointmentType: { id: String(this.config.default_appointment_type_id) } }
        : {}),
      note: data.reason || data.appointment_type || 'Somo voice booking'
    };

    const raw = await this.client.post('/v1/appointments', body);
    const created = this.client.unwrap(raw);
    const apptId = created?.id || created?.appointmentId || null;
    if (!apptId) {
      return { success: false, error: 'Dentrix book returned no appointment id', raw: created };
    }

    return {
      success: true,
      appointment: {
        id: String(apptId),
        external_id: String(apptId),
        patient_id: dentrixPatientId,
        patient_name: data.patient_name,
        date: data.date,
        time: data.time,
        status: 'scheduled',
        appointment_type: data.appointment_type
      },
      appointment_id: String(apptId),
      pms_external_id: String(apptId),
      pms_source: 'dentrix'
    };
  }

  async rescheduleAppointment(appointmentId, newDate, newTime) {
    this._requireCreds();
    const timeMatch = String(newTime || '').match(/(\d{1,2}):(\d{2})/);
    let hour = timeMatch ? parseInt(timeMatch[1], 10) : 9;
    const min = timeMatch ? timeMatch[2] : '00';
    if (String(newTime).toUpperCase().includes('PM') && hour < 12) hour += 12;
    if (String(newTime).toUpperCase().includes('AM') && hour === 12) hour = 0;
    const start = `${newDate}T${String(hour).padStart(2, '0')}:${min}:00`;

    await this.client.put(`/v1/appointments/${appointmentId}`, { start });
    return { success: true, appointment_id: appointmentId, date: newDate, time: newTime };
  }

  async cancelAppointment(appointmentId, reason) {
    this._requireCreds();
    await this.client.put(`/v1/appointments/${appointmentId}`, {
      status: 'BROKEN',
      note: reason || 'Cancelled via Somo'
    });
    return { success: true, appointment_id: appointmentId };
  }

  async writeNote({ patient_id, text, note_type = 'front_desk' } = {}) {
    this._requireCreds();
    const noteText = `[${note_type}] ${text}`;
    if (!patient_id) {
      return { success: false, error: 'patient_id required for Dentrix note' };
    }
    try {
      await this.client.post(`/v1/patients/${patient_id}/notes`, { text: noteText });
      return { success: true, patient_id, note: noteText };
    } catch (e) {
      return { success: true, stored: 'log_only', patient_id, note: noteText, warning: e.message };
    }
  }
}

module.exports = { DentrixAdapter, sanitizeDentrixFilterValue };
