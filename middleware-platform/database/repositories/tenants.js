'use strict';

/**
 * Tenants / clinics repository slice (Phase 7).
 */
const db = require('../../database');

module.exports = {
  getClinic: db.getClinic,
  getClinicById: db.getClinicById.bind(db),
  getClinicBySlug: db.getClinicBySlug.bind(db),
  getClinicByPhoneNumber: db.getClinicByPhoneNumber.bind(db),
  getClinicPhoneNumber: db.getClinicPhoneNumber.bind(db),
  getClinicPhoneNumbers: db.getClinicPhoneNumbers.bind(db),
  getClinicPromptProfile: db.getClinicPromptProfile.bind(db),
  getClinicSetting: db.getClinicSetting.bind(db),
};
