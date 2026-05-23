'use strict';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateOnly(iso) {
  const s = String(iso || '').trim();
  if (!ISO_DATE_RE.test(s)) return null;
  const d = new Date(`${s}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoFromDate(d) {
  return d.toISOString().slice(0, 10);
}

function todayIsoUtc() {
  return isoFromDate(new Date());
}

function daysBetweenUtc(fromIso, toIso) {
  const a = parseIsoDateOnly(fromIso);
  const b = parseIsoDateOnly(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * @param {string} targetDateIso YYYY-MM-DD
 * @param {string} [todayIso] defaults to UTC today
 * @returns {{
 *   mode: 'today' | 'backfill' | 'historical',
 *   is_mutable: boolean,
 *   allows_photo: boolean,
 *   allows_daily_post: boolean,
 *   days_ago: number | null
 * }}
 */
function resolveRoutineDayMode(targetDateIso, todayIso = todayIsoUtc()) {
  const target = String(targetDateIso || '').trim();
  const today = String(todayIso || '').trim();
  if (!parseIsoDateOnly(target) || !parseIsoDateOnly(today)) {
    return {
      mode: 'historical',
      is_mutable: false,
      allows_photo: false,
      allows_daily_post: false,
      days_ago: null,
    };
  }

  const delta = daysBetweenUtc(target, today);
  if (delta === null) {
    return {
      mode: 'historical',
      is_mutable: false,
      allows_photo: false,
      allows_daily_post: false,
      days_ago: null,
    };
  }

  if (delta < 0) {
    return {
      mode: 'historical',
      is_mutable: false,
      allows_photo: false,
      allows_daily_post: false,
      days_ago: null,
    };
  }

  if (delta === 0) {
    return {
      mode: 'today',
      is_mutable: true,
      allows_photo: true,
      allows_daily_post: true,
      days_ago: 0,
    };
  }

  if (delta <= 2) {
    return {
      mode: 'backfill',
      is_mutable: true,
      allows_photo: true,
      allows_daily_post: false,
      days_ago: delta,
    };
  }

  return {
    mode: 'historical',
    is_mutable: false,
    allows_photo: false,
    allows_daily_post: false,
    days_ago: delta,
  };
}

function isPurgeWindowPhase(programWeek, phaseKey, concernId) {
  const week = Number(programWeek) || 0;
  const key = String(phaseKey || '').trim();
  if (concernId === 'acne' && week >= 3 && week <= 5) return true;
  if (key === 'weeks_3_4' || key === 'weeks_5_8') return true;
  return false;
}

function truncateSnippet(text, maxLen = 60) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

module.exports = {
  ISO_DATE_RE,
  parseIsoDateOnly,
  todayIsoUtc,
  daysBetweenUtc,
  resolveRoutineDayMode,
  isPurgeWindowPhase,
  truncateSnippet,
};
