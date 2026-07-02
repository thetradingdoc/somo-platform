'use strict';

const db = require('../database');

const DENTAL_PMS_TYPES = new Set(['somo', 'dentrix', 'eaglesoft']);

function resolveOfficeType(clinicId) {
  if (!clinicId || !db.db) return null;
  const clinic = db.db.prepare('SELECT office_type, pms_type FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (clinic?.office_type) return String(clinic.office_type).toLowerCase();
  const profile = db.db
    .prepare(`SELECT use_case FROM prompt_profiles WHERE clinic_id = ? LIMIT 1`)
    .get(clinicId);
  if (profile?.use_case === 'dental') return 'dental';
  if (DENTAL_PMS_TYPES.has(String(clinic?.pms_type || '').toLowerCase())) return 'dental';
  return 'medical';
}

function shouldBlock1upHealthForClinic(clinicId) {
  const officeType = resolveOfficeType(clinicId);
  if (officeType === 'dental') return true;
  const clinic = clinicId && db.db
    ? db.db.prepare('SELECT pms_type FROM clinics WHERE clinic_id = ?').get(clinicId)
    : null;
  return DENTAL_PMS_TYPES.has(String(clinic?.pms_type || '').toLowerCase());
}

function assert1upHealthAllowed({ clinicId, providerId } = {}) {
  const cid =
    clinicId ||
    (providerId && db.db
      ? db.db.prepare('SELECT clinic_id FROM users WHERE id = ? LIMIT 1').get(providerId)?.clinic_id
      : null);
  if (cid && shouldBlock1upHealthForClinic(cid)) {
    const err = new Error(
      '1upHealth EHR aggregator is not available for dental offices. Connect your PMS (Somo calendar or Dentrix) in Settings.'
    );
    err.code = 'DENTAL_EHR_AGGREGATOR_BLOCKED';
    err.status = 403;
    throw err;
  }
  return { allowed: true, clinic_id: cid };
}

module.exports = {
  DENTAL_PMS_TYPES,
  resolveOfficeType,
  shouldBlock1upHealthForClinic,
  assert1upHealthAllowed
};
