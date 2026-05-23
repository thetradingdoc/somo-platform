'use strict';

const db = require('../database');

const FALLBACK_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || null;

function resolveClinicIdFromRequest(req, args = {}) {
  const directClinicId =
    args?.clinic_id ||
    req.headers['x-clinic-id'] ||
    req.query?.clinic_id ||
    (req.body && !req.body.args ? req.body.clinic_id : (req.body?.args?.clinic_id || req.body?.clinic_id)) ||
    null;

  if (directClinicId) {
    return directClinicId;
  }

  const fromPhone = req.body?.From || req.body?.from_number || req.body?.patient_phone || args?.patient_phone;
  if (fromPhone && db && db.getClinicPhoneNumber) {
    try {
      let normalized = fromPhone;
      try {
        const SMSService = require('../services/sms-service');
        normalized = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(fromPhone) : fromPhone.replace(/\D/g, '');
      } catch {
        normalized = fromPhone.replace(/\D/g, '');
      }
      const row = db.getClinicPhoneNumber(normalized);
      if (row?.clinic_id) return row.clinic_id;
    } catch (_) {}
  }

  if (FALLBACK_CLINIC_ID) {
    return FALLBACK_CLINIC_ID;
  }

  return null;
}

module.exports = { FALLBACK_CLINIC_ID, resolveClinicIdFromRequest };
