'use strict';

const dbModule = require('../../database');
const { enrichBiochemFacts } = require('./ingredient-ontology-resolver');
const { resolveCidByName } = require('../platform/pubchem-ingredient-service');
const Metrics = require('../shared/metrics');

const db = dbModule.db;

/** When 1, biochemical rows are considered production-authoritative (still best-effort; no throw). */
const ENFORCE = String(process.env.INGREDIENT_BIOCHEM_ENFORCE || '0') === '1';

async function upsertBiochemFromCanonicalName(canonicalInci) {
  const name = String(canonicalInci || '').trim().toLowerCase();
  if (!name) return { ok: false };

  const facts = enrichBiochemFacts([{ name }]);
  const row = facts[0] || {
    inci_name: name,
    pathways: [],
    evidence_level: 'low',
    derivative_of: null,
    molecular_class: 'other'
  };

  let cid = null;
  const wantPubchem = String(process.env.INGREDIENT_PUBCHEM_LOOKUP || '1') !== '0';
  if (wantPubchem) {
    const pc = await resolveCidByName(name);
    if (pc.success && pc.cid) {
      cid = pc.cid;
      Metrics.increment('ingredient_taxonomy.pubchem_hit.count', 1);
    } else {
      Metrics.increment('ingredient_taxonomy.pubchem_miss.count', 1);
    }
  }

  db.prepare(`
    INSERT INTO ingredient_biochem (
      inci_name, derivative_of, molecular_class, pathways_json, evidence_level, pubchem_cid, metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(inci_name) DO UPDATE SET
      derivative_of=excluded.derivative_of,
      molecular_class=excluded.molecular_class,
      pathways_json=excluded.pathways_json,
      evidence_level=excluded.evidence_level,
      pubchem_cid=COALESCE(excluded.pubchem_cid, ingredient_biochem.pubchem_cid),
      metadata_json=excluded.metadata_json,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    row.inci_name || name,
    row.derivative_of || null,
    row.molecular_class || null,
    JSON.stringify(row.pathways || []),
    row.evidence_level || 'low',
    cid,
    JSON.stringify({ source: 'internal_taxonomy_v1', pubchem: cid ? { cid } : null })
  );

  Metrics.increment('ingredient_taxonomy.biochem_upsert.count', 1);
  return { ok: true, inci_name: row.inci_name || name, pubchem_cid: cid };
}

module.exports = { upsertBiochemFromCanonicalName, ENFORCE };
