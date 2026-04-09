'use strict';

const BASE = (process.env.DAILYMED_BASE_URL || 'https://dailymed.nlm.nih.gov/dailymed/services/v2').replace(/\/$/, '');

async function searchSplByDrugName(drugName, limit = 3) {
  const q = String(drugName || '').trim();
  if (!q) return { success: false, error: 'empty', spls: [] };
  const url = `${BASE}/spls.json?${new URLSearchParams({ drug_name: q, pagesize: String(Math.min(limit, 100)) }).toString()}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'doclittle-platform/1.0' } });
    if (!r.ok) return { success: false, error: `http_${r.status}`, spls: [] };
    const data = await r.json();
    const spls = Array.isArray(data.data) ? data.data : [];
    return { success: true, spls };
  } catch (e) {
    return { success: false, error: String(e.message || e), spls: [] };
  }
}

function splSuggestsDrugFacts(spl) {
  const t = JSON.stringify(spl || {}).toLowerCase();
  return /\bdrug facts\b|active ingredient|purpose\b/i.test(t);
}

module.exports = { searchSplByDrugName, splSuggestsDrugFacts };
