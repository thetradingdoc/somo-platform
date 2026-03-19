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
 * Normalize date to YYYY-MM-DD for parsing (handles some alternate formats)
 */
function normalizeDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Check if a date is a business day for the clinic.
 * @param {string} dateStr YYYY-MM-DD (or parseable date)
 * @param {Object} config From getClinicBusinessHours
 */
function isBusinessDay(dateStr, config) {
  const normalized = normalizeDateStr(dateStr) || dateStr;
  const d = new Date(normalized + 'T12:00:00');
  if (isNaN(d.getTime())) return false;
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const businessDays = config.business_days || DEFAULT.business_days;
  if (!businessDays.includes(day)) return false;
  if (config.holidays && config.holidays.includes(normalized)) return false;
  return true;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Get next business day after dateStr (YYYY-MM-DD)
 */
function getNextBusinessDay(dateStr, config) {
  const normalized = normalizeDateStr(dateStr);
  if (!normalized) return null;
  const businessDays = config?.business_days || DEFAULT.business_days;
  let d = new Date(normalized + 'T12:00:00');
  for (let i = 0; i < 8; i++) {
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayNum = String(d.getDate()).padStart(2, '0');
    const next = `${y}-${m}-${dayNum}`;
    const dayOfWeek = d.getDay();
    if (businessDays.includes(dayOfWeek) && (!config?.holidays || !config.holidays.includes(next))) {
      return next;
    }
  }
  return null;
}

module.exports = {
  getClinicBusinessHours,
  isBusinessDay,
  getNextBusinessDay,
  normalizeDateStr,
  DAY_NAMES,
  DEFAULT
};
