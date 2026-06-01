'use strict';

function isValidIanaTimezone(value) {
  const tz = (value || '').toString().trim();
  if (!tz) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { isValidIanaTimezone };
