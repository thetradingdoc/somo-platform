'use strict';

/**
 * Keep a single canonical SMS/voice phone per clinic identity (email or FHIR patient_id)
 * so the calendar and reminders never "split" one person across multiple numbers.
 */

const db = require('../../database');

function digitsOnly(phone) {
  if (phone == null || phone === '') return '';
  return String(phone).replace(/\D/g, '');
}

function formatE164Prefer(phone) {
  if (phone == null || phone === '') return phone;
  try {
    const SMSService = require('../platform/sms-service');
    if (typeof SMSService.formatPhoneNumber === 'function') {
      return SMSService.formatPhoneNumber(phone);
    }
  } catch (_) {}
  const d = digitsOnly(phone);
  if (!d) return String(phone).trim();
  if (d.length === 10) return `+1${d}`;
  if (String(phone).trim().startsWith('+')) return `+${d}`;
  return d.length >= 10 ? `+${d}` : String(phone).trim();
}

function normalizeEmail(email) {
  if (email == null || typeof email !== 'string') return null;
  const t = email.trim().toLowerCase();
  return t || null;
}

function normalizePatientName(name) {
  if (name == null) return name;
  return String(name).trim().replace(/\s+/g, ' ');
}

function phonesDiffer(a, b) {
  const da = digitsOnly(a);
  const dbx = digitsOnly(b);
  if (!da && !dbx) return false;
  if (!da || !dbx) return true;
  const norm = (x) => {
    if (x.length === 11 && x.startsWith('1')) return x.slice(1);
    return x;
  };
  return norm(da) !== norm(dbx);
}

function getCanonicalPhoneFromExistingAppointments(clinicId, patientEmail, patientId) {
  const sqlite = db.db;
  if (!sqlite || !clinicId) return null;

  if (patientEmail) {
    const em = normalizeEmail(patientEmail);
    const row = sqlite.prepare(`
      SELECT patient_phone
      FROM appointments
      WHERE clinic_id = ?
        AND deleted_at IS NULL
        AND patient_phone IS NOT NULL
        AND TRIM(patient_phone) != ''
        AND LOWER(TRIM(patient_email)) = ?
      ORDER BY datetime(COALESCE(start_time, created_at)) DESC
      LIMIT 1
    `).get(clinicId, em);
    if (row?.patient_phone) return row.patient_phone;
  }

  if (patientId) {
    const row = sqlite.prepare(`
      SELECT patient_phone
      FROM appointments
      WHERE clinic_id = ?
        AND deleted_at IS NULL
        AND patient_phone IS NOT NULL
        AND TRIM(patient_phone) != ''
        AND patient_id = ?
      ORDER BY datetime(COALESCE(start_time, created_at)) DESC
      LIMIT 1
    `).get(clinicId, patientId);
    if (row?.patient_phone) return row.patient_phone;
  }

  return null;
}

function backfillMismatchedPhones(clinicId, canonicalPhone, patientEmail, patientId) {
  const sqlite = db.db;
  if (!sqlite || !clinicId || !canonicalPhone) return 0;

  let rows = [];
  if (patientEmail) {
    rows = sqlite.prepare(`
      SELECT id, patient_phone FROM appointments
      WHERE clinic_id = ?
        AND deleted_at IS NULL
        AND LOWER(TRIM(patient_email)) = ?
    `).all(clinicId, normalizeEmail(patientEmail));
  } else if (patientId) {
    rows = sqlite.prepare(`
      SELECT id, patient_phone FROM appointments
      WHERE clinic_id = ?
        AND deleted_at IS NULL
        AND patient_id = ?
    `).all(clinicId, patientId);
  }

  let n = 0;
  for (const r of rows) {
    if (phonesDiffer(r.patient_phone, canonicalPhone)) {
      sqlite.prepare(`
        UPDATE appointments
        SET patient_phone = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(canonicalPhone, r.id);
      n += 1;
    }
  }
  return n;
}

/**
 * Mutates appointment (or appointment-shaped object). Call before insert/update flows.
 * @param {object} appointment
 * @param {{ backfill?: boolean, logTag?: string }} opts
 */
function enforceCanonicalPatientPhone(appointment, opts = {}) {
  const backfill = opts.backfill !== false;
  const logTag = opts.logTag || '[patient-contact]';
  if (!appointment || typeof appointment !== 'object') return appointment;

  const clinicId = appointment.clinic_id || null;
  if (!clinicId) return appointment;

  if (appointment.patient_name != null) {
    appointment.patient_name = normalizePatientName(appointment.patient_name);
  }
  const email = normalizeEmail(appointment.patient_email);
  if (email) appointment.patient_email = email;

  if (appointment.patient_phone != null && appointment.patient_phone !== '') {
    appointment.patient_phone = formatE164Prefer(appointment.patient_phone);
  }

  const incoming = appointment.patient_phone;
  if (!incoming) return appointment;

  const patientId = appointment.patient_id || null;
  const canonicalRaw = getCanonicalPhoneFromExistingAppointments(clinicId, email, patientId);
  if (!canonicalRaw) return appointment;

  const canonical = formatE164Prefer(canonicalRaw);
  if (!phonesDiffer(incoming, canonical)) return appointment;

  console.warn(
    `${logTag} Using clinic-canonical phone for identity ${email || patientId || 'unknown'}: "${incoming}" -> "${canonical}"`
  );
  appointment.patient_phone = canonical;

  if (backfill) {
    try {
      const n = backfillMismatchedPhones(clinicId, canonical, email, patientId);
      if (n > 0) console.warn(`${logTag} Backfilled patient_phone on ${n} existing appointment row(s).`);
    } catch (e) {
      console.warn(`${logTag} Backfill skipped:`, e.message);
    }
  }

  return appointment;
}

/**
 * Single UI/API identity for admin patient search when email is present we collapse
 * all rows to one (canonical phone from most recent appointment is selected by caller).
 */
function adminPatientSearchDedupeKey(name, phone, email) {
  const em = normalizeEmail(email);
  if (em) return `email:${em}`;
  const nm = normalizePatientName(name);
  const d = digitsOnly(phone);
  return `orphan:${String(nm || '').toLowerCase()}|${d}`;
}

module.exports = {
  enforceCanonicalPatientPhone,
  formatE164Prefer,
  normalizeEmail,
  normalizePatientName,
  phonesDiffer,
  getCanonicalPhoneFromExistingAppointments,
  adminPatientSearchDedupeKey
};
