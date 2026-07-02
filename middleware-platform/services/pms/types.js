'use strict';

/** @typedef {'none'|'somo'|'athena'|'dentrix'|'eaglesoft'} PmsType */

/**
 * @typedef {Object} PmsPatient
 * @property {string} [id]
 * @property {string} [external_id]
 * @property {string} [first_name]
 * @property {string} [last_name]
 * @property {string} [full_name]
 * @property {string} [phone]
 * @property {string} [email]
 * @property {string} [dob]
 * @property {boolean} [is_returning]
 * @property {'high'|'medium'|'low'} [match_confidence]
 */

/**
 * @typedef {Object} PmsSlot
 * @property {string} time
 * @property {string} [date]
 * @property {string} [display]
 * @property {string} [slot_start_iso]
 * @property {string} [practitioner_id]
 */

/**
 * @typedef {Object} PmsAppointment
 * @property {string} id
 * @property {string} [external_id]
 * @property {string} [patient_id]
 * @property {string} [patient_name]
 * @property {string} date
 * @property {string} time
 * @property {string} [status]
 * @property {string} [appointment_type]
 */

/**
 * @typedef {Object} PmsContext
 * @property {boolean} success
 * @property {PmsPatient|null} [patient]
 * @property {PmsAppointment|null} [next_appointment]
 * @property {boolean} [balance_flag]
 * @property {boolean} [has_insurance]
 * @property {boolean} [is_returning]
 * @property {string} [pms_type]
 * @property {string} [error]
 * @property {boolean} [degraded]
 */

/**
 * @typedef {Object} PmsHealth
 * @property {boolean} ok
 * @property {string} pms_type
 * @property {string} [message]
 * @property {string} [last_error]
 * @property {string} [last_sync_at]
 */

module.exports = {};
