'use strict';

const BASE = (process.env.RXNORM_BASE_URL || 'https://rxnav.nlm.nih.gov/REST').replace(/\/$/, '');

async function normalizeDrugName(name) {
  const q = String(name || '').trim();
  if (!q) return { success: false, error: 'empty', rxcui: null, synonyms: [] };
  const url = `${BASE}/drugs.json?name=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'doclittle-platform/1.0' } });
    if (!r.ok) return { success: false, error: `http_${r.status}`, rxcui: null, synonyms: [] };
    const data = await r.json();
    const groups = data?.drugGroup?.conceptGroup || [];
    const rxcuis = [];
    const names = [];
    for (const g of groups) {
      for (const c of g.conceptProperties || []) {
        if (c.rxcui) rxcuis.push(c.rxcui);
        if (c.name) names.push(c.name);
      }
    }
    return {
      success: true,
      rxcui: rxcuis[0] || null,
      synonyms: names.slice(0, 20)
    };
  } catch (e) {
    return { success: false, error: String(e.message || e), rxcui: null, synonyms: [] };
  }
}

module.exports = { normalizeDrugName };
