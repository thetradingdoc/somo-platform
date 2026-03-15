/**
 * Per-clinic calendar configuration (Tasks 1, 5)
 * Task 1: Single calendar per env - no per-clinic or per-provider calendar.
 * When CALENDAR_SINGLE_PER_ENV=1 (default), clinic-specific config is ignored.
 */

const db = require('../database');

const CALENDAR_SINGLE_PER_ENV = (process.env.CALENDAR_SINGLE_PER_ENV || '1') === '1';

/**
 * Use single calendar per environment (Task 1).
 * When true, per-clinic and per-provider calendar IDs are ignored.
 * @returns {boolean}
 */
function useSingleCalendarPerEnv() {
  return CALENDAR_SINGLE_PER_ENV;
}

/**
 * Get calendar config for a clinic.
 * Returns null when CALENDAR_SINGLE_PER_ENV=1 (Task 1: single calendar per env).
 * @param {string} clinicId
 * @returns {{ userEmail?: string, calendarId?: string }|null}
 */
function getClinicCalendarConfig(clinicId) {
  if (useSingleCalendarPerEnv()) return null;
  if (!clinicId) return null;

  try {
    const clinic = db.getClinicById ? db.getClinicById(clinicId) : null;
    if (!clinic) return null;

    const config = {};

    if (clinic.calendar_user_email) {
      config.userEmail = clinic.calendar_user_email;
    }
    if (clinic.google_calendar_id) {
      config.calendarId = clinic.google_calendar_id;
    }

    return Object.keys(config).length ? config : null;
  } catch (_) {
    return null;
  }
}

module.exports = { getClinicCalendarConfig, useSingleCalendarPerEnv };
