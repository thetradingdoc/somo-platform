'use strict';

/**
 * Appointments repository slice (Phase 7).
 * Re-exports from database.js facade — migrate SQL here incrementally.
 */
const db = require('../../database');

module.exports = {
  createAppointment: db.createAppointment.bind(db),
  getAppointment: db.getAppointment.bind(db),
  getAppointmentsByDate: db.getAppointmentsByDate.bind(db),
  getAppointmentsByPatientIds: db.getAppointmentsByPatientIds.bind(db),
  getAppointmentIdFromCaseNumber: db.getAppointmentIdFromCaseNumber.bind(db),
};
