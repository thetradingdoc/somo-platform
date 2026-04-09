'use strict';

const BASE = (process.env.OPENFDA_BASE_URL || 'https://api.fda.gov/drug').replace(/\/$/, '');
const API_KEY = process.env.OPENFDA_API_KEY || '';

function withKey(url) {
  if (!API_KEY) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}api_key=${encodeURIComponent(API_KEY)}`;
}

/**
 * Search FDA NDC directory by brand or generic name (best-effort for product grading).
 * @param {string} term
 * @param {number} limit
 */
async function searchNdcByName(term, limit = 5) {
  const q = String(term || '').trim();
  if (q.length < 2) return { success: false, error: 'empty', results: [] };
  const esc = q.replace(/["\\]/g, '');
  for (const field of ['brand_name', 'generic_name']) {
    const search = encodeURIComponent(`${field}:"${esc}"`);
    const url = withKey(`${BASE}/ndc.json?search=${search}&limit=${Math.min(limit, 100)}`);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'doclittle-platform/1.0' } });
      if (!r.ok) continue;
      const data = await r.json();
      const results = Array.isArray(data.results) ? data.results : [];
      if (results.length) return { success: true, results, matched_field: field };
    } catch (_) {}
  }
  return { success: true, results: [], matched_field: null };
}

/**
 * Broader search: OR brand OR generic contains token.
 */
async function searchNdcLoose(term, limit = 5) {
  const q = String(term || '').trim();
  if (q.length < 2) return { success: false, error: 'empty', results: [] };
  const esc = q.replace(/["\\]/g, '').split(/\s+/)[0];
  if (!esc) return { success: true, results: [] };
  const search = encodeURIComponent(`brand_name:${esc}*`);
  const url = withKey(`${BASE}/ndc.json?search=${search}&limit=${Math.min(limit, 100)}`);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'doclittle-platform/1.0' } });
    if (!r.ok) return { success: false, error: `http_${r.status}`, results: [] };
    const data = await r.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return { success: true, results };
  } catch (e) {
    return { success: false, error: String(e.message || e), results: [] };
  }
}

function inferGradeFromNdcRecord(rec) {
  const cat = String(rec?.marketing_category || rec?.openfda?.marketing_category?.[0] || '').toUpperCase();
  const ptype = String(rec?.product_type || '').toUpperCase();
  const route = String(rec?.dosage_form || rec?.route || '').toLowerCase();
  if (/OTC|OTC_MONOGRAPH|NDC_OTC|HUMAN\s+OTC/i.test(cat) || /HUMAN\s+OTC\s+DRUG/.test(ptype)) {
    return { grade_class: 'OTC_DRUG', confidence: 'high', rationale: [`fda:${cat || ptype || 'OTC'}`] };
  }
  if (/PRESCRIPTION|RX|NDA|ANDA|BLA/i.test(cat) || /HUMAN\s+PRESCRIPTION/.test(ptype)) {
    return { grade_class: 'MEDICAL_RX', confidence: 'high', rationale: [`fda:${cat || ptype || 'RX'}`] };
  }
  if (route && !cat) {
    return { grade_class: 'GENERAL_COSMETIC', confidence: 'low', rationale: ['fda_ndc_match_unclear_category'] };
  }
  return null;
}

function bestGradeFromResults(results) {
  let best = null;
  for (const rec of results || []) {
    const g = inferGradeFromNdcRecord(rec);
    if (!g) continue;
    if (g.grade_class === 'MEDICAL_RX') return g;
    if (g.grade_class === 'OTC_DRUG' && (!best || best.grade_class !== 'MEDICAL_RX')) best = g;
  }
  return best || (results?.length ? { grade_class: 'GENERAL_COSMETIC', confidence: 'low', rationale: ['fda_ndc_no_clear_category'] } : null);
}

module.exports = { searchNdcByName, searchNdcLoose, inferGradeFromNdcRecord, bestGradeFromResults };
