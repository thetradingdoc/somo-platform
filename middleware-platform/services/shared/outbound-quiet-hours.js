'use strict';

const DEFAULT_QUIET = { start: '08:00', end: '20:00', timezone: 'America/New_York' };

function parseQuietHours(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

function localHourMinute(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function parseHm(hm) {
  const [h, m] = String(hm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isWithinQuietHours(quietHours, now = new Date()) {
  const q = parseQuietHours(quietHours) || DEFAULT_QUIET;
  const tz = q.timezone || DEFAULT_QUIET.timezone;
  const nowMin = localHourMinute(now, tz);
  const start = parseHm(q.start || DEFAULT_QUIET.start);
  const end = parseHm(q.end || DEFAULT_QUIET.end);
  if (start <= end) return nowMin >= start && nowMin < end;
  return nowMin >= start || nowMin < end;
}

function assertOutboundAllowed(settings, { now = new Date() } = {}) {
  const quiet = parseQuietHours(settings?.outbound_quiet_hours) || DEFAULT_QUIET;
  if (!isWithinQuietHours(quiet, now)) {
    const err = new Error('Outbound calls are not allowed outside configured quiet hours.');
    err.code = 'outbound_quiet_hours';
    throw err;
  }
}

module.exports = {
  DEFAULT_QUIET,
  parseQuietHours,
  isWithinQuietHours,
  assertOutboundAllowed
};
