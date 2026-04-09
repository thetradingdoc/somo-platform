'use strict';

const BASE = (process.env.PUBCHEM_REST_BASE || 'https://pubchem.ncbi.nlm.nih.gov/rest/pug').replace(/\/$/, '');

async function resolveCidByName(name) {
  const q = String(name || '').trim();
  if (q.length < 2) return { success: false, error: 'empty', cid: null };
  const url = `${BASE}/compound/name/${encodeURIComponent(q)}/cids/JSON?MaxRecords=1`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'doclittle-platform/1.0' } });
    if (!r.ok) return { success: false, error: `http_${r.status}`, cid: null };
    const data = await r.json();
    const list = data?.IdentifierList?.CID;
    const cid = Array.isArray(list) ? list[0] : list;
    return { success: !!cid, cid: cid ? String(cid) : null };
  } catch (e) {
    return { success: false, error: String(e.message || e), cid: null };
  }
}

module.exports = { resolveCidByName };
