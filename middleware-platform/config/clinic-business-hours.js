/**
 * Per-clinic business hours configuration (Task 3, 51)
 * Supports timezone, start/end hours, days of week, and holidays.
 * Falls back to env/default when clinic not configured.
 */

const db = require('../database');

const DEFAULT = {
  start: 9,
  end: 19,
  timezone: process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York',
  slot_interval_minutes: 15,
  // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 0=Sun
  business_days: [1, 2, 3, 4, 5],
  holidays: [] // array of YYYY-MM-DD strings
};

/**
 * Get business hours config for a clinic.
 * Uses clinic.timezone, clinic.business_hours_start, clinic.business_hours_end, clinic.business_days.
 * @param {string} clinicId
 * @returns {Object}
 */
function getClinicBusinessHours(clinicId) {
  if (!clinicId) return { ...DEFAULT };

  try {
    const clinic = db.getClinicById ? db.getClinicById(clinicId) : null;
    if (!clinic) return { ...DEFAULT };

    let business_days = DEFAULT.business_days;
    if (clinic.business_days) {
      try {
        business_days = typeof clinic.business_days === 'string'
          ? JSON.parse(clinic.business_days)
          : clinic.business_days;
      } catch (_) {
        business_days = DEFAULT.business_days;
      }
    }

    let holidays = DEFAULT.holidays;
    if (clinic.holidays) {
      try {
        holidays = typeof clinic.holidays === 'string'
          ? JSON.parse(clinic.holidays)
          : clinic.holidays;
      } catch (_) {
        holidays = DEFAULT.holidays;
      }
    }

    return {
      start: clinic.business_hours_start != null ? Number(clinic.business_hours_start) : DEFAULT.start,
      end: clinic.business_hours_end != null ? Number(clinic.business_hours_end) : DEFAULT.end,
      timezone: clinic.timezone || DEFAULT.timezone,
      slot_interval_minutes: DEFAULT.slot_interval_minutes,
      business_days: Array.isArray(business_days) ? business_days : DEFAULT.business_days,
      holidays: Array.isArray(holidays) ? holidays : DEFAULT.holidays
    };
  } catch (_) {
    return { ...DEFAULT };
  }
}

/**
 * Check if a date is a business day for the clinic.
 * @param {string} dateStr YYYY-MM-DD
 * @param {Object} config From getClinicBusinessHours
 */
function isBusinessDay(dateStr, config) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const businessDays = config.business_days || DEFAULT.business_days;
  if (!businessDays.includes(day)) return false;
  if (config.holidays && config.holidays.includes(dateStr)) return false;
  return true;
}

module.exports = {
  getClinicBusinessHours,
  isBusinessDay,
  DEFAULT
};
