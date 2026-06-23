'use strict';

/**
 * Place of service, telehealth modifiers, and payer-type helpers for 837P claim envelope.
 */

const TELEHEALTH_POS = new Set(['02', '10']);

function resolvePlaceOfService({ visit_mode, place_of_service } = {}) {
  if (place_of_service) {
    const code = String(place_of_service).trim();
    return code.length === 1 ? `0${code}` : code.slice(0, 2);
  }
  const mode = String(visit_mode || 'sync_video').toLowerCase();
  if (mode === 'in_person' || mode === 'office' || mode === 'in-person') return '11';
  if (mode === 'async_review') return '02';
  if (mode === 'sync_video' || mode === 'video') return '02';
  return '02';
}

function isTelehealthPlaceOfService(pos) {
  const code = String(pos || '').trim();
  return TELEHEALTH_POS.has(code.length === 1 ? `0${code}` : code.slice(0, 2));
}

function isMedicarePayer(payerId) {
  const p = String(payerId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!p) return false;
  if (p.includes('MEDICARE') || p.includes('MCARE')) return true;
  if (p === 'CMS' || p.startsWith('CMS')) return true;
  if (/^00801/.test(p)) return true;
  return false;
}

/**
 * @returns {string[]} Modifier codes to append for telehealth (e.g. ['95'] or ['GT'])
 */
function resolveTelehealthModifiers({ place_of_service, visit_mode, payer_id, existing_modifiers = [] } = {}) {
  const pos = resolvePlaceOfService({ visit_mode, place_of_service });
  if (!isTelehealthPlaceOfService(pos)) return [...existing_modifiers];

  const mods = new Set((existing_modifiers || []).map((m) => String(m).trim().toUpperCase()).filter(Boolean));
  const teleMod = isMedicarePayer(payer_id) ? 'GT' : '95';
  mods.add(teleMod);
  return Array.from(mods);
}

function parseCptModifiersJson(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function serializeCptModifiers(mods) {
  return JSON.stringify((mods || []).map((m) => String(m).trim().toUpperCase()).filter(Boolean));
}

module.exports = {
  TELEHEALTH_POS,
  resolvePlaceOfService,
  isTelehealthPlaceOfService,
  isMedicarePayer,
  resolveTelehealthModifiers,
  parseCptModifiersJson,
  serializeCptModifiers
};
