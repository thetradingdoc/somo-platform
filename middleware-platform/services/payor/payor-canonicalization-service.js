'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');

const SOURCE_PRECEDENCE = ['cms_ma_plan_directory', 'inovalon', 'office_ally', 'nppes_api', 'nppes_bulk', 'nucc_csv'];

function normalizeAlias(alias) {
  return String(alias || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class DSU {
  constructor() { this.parent = new Map(); }
  add(x) { if (!this.parent.has(x)) this.parent.set(x, x); }
  find(x) {
    this.add(x);
    let p = this.parent.get(x);
    while (p !== this.parent.get(p)) p = this.parent.get(p);
    let cur = x;
    while (cur !== p) {
      const nxt = this.parent.get(cur);
      this.parent.set(cur, p);
      cur = nxt;
    }
    return p;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

function chooseByPrecedence(items, getter) {
  const sorted = [...items].sort((a, b) => SOURCE_PRECEDENCE.indexOf(a.source) - SOURCE_PRECEDENCE.indexOf(b.source));
  for (const item of sorted) {
    const val = getter(item);
    if (val != null && String(val).trim() !== '') return String(val).trim();
  }
  return null;
}

function buildCanonicalEntities({ policyVersion = null, limit = 50000, offset = 0 } = {}) {
  const rows = db.getPayorResolutionRowsForCanonicalization({ policyVersion, limit, offset });
  const dsu = new DSU();
  for (const r of rows) {
    dsu.union(r.left_source_record_id, r.right_source_record_id);
  }

  const clusters = new Map();
  for (const r of rows) {
    const points = [
      {
        source_record_id: r.left_source_record_id,
        source: r.left_source,
        raw_name: r.left_raw_name,
        raw_payer_id: r.left_raw_payer_id,
        raw_npi: r.left_raw_npi,
        raw_ein: r.left_raw_ein,
        raw_state_hint: r.left_state_hint,
        decision_id: r.decision_id
      },
      {
        source_record_id: r.right_source_record_id,
        source: r.right_source,
        raw_name: r.right_raw_name,
        raw_payer_id: r.right_raw_payer_id,
        raw_npi: r.right_raw_npi,
        raw_ein: r.right_raw_ein,
        raw_state_hint: r.right_state_hint,
        decision_id: r.decision_id
      }
    ];
    for (const p of points) {
      const root = dsu.find(p.source_record_id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(p);
    }
  }

  const entities = [];
  const aliases = [];
  const links = [];
  for (const members of clusters.values()) {
    const uniqByRecord = new Map();
    for (const m of members) uniqByRecord.set(m.source_record_id, m);
    const uniq = Array.from(uniqByRecord.values());
    const entityId = `payor_entity_${uuidv4()}`;

    const canonical_name =
      chooseByPrecedence(uniq, (x) => x.raw_name) ||
      `payor_entity_${entityId.slice(-8)}`;
    const canonical_payer_id = chooseByPrecedence(uniq, (x) => x.raw_payer_id);
    const canonical_npi = chooseByPrecedence(uniq, (x) => x.raw_npi);
    const canonical_ein = chooseByPrecedence(uniq, (x) => x.raw_ein);
    const state_scope = chooseByPrecedence(uniq, (x) => x.raw_state_hint);

    entities.push({
      id: entityId,
      canonical_name,
      canonical_payer_id,
      canonical_npi,
      canonical_ein,
      state_scope,
      status: 'active'
    });

    const aliasSeen = new Set();
    for (const m of uniq) {
      if (m.raw_name) {
        const norm = normalizeAlias(m.raw_name);
        if (norm && !aliasSeen.has(norm)) {
          aliasSeen.add(norm);
          aliases.push({
            id: `payor_alias_${uuidv4()}`,
            entity_id: entityId,
            alias: m.raw_name,
            alias_normalized: norm,
            source: m.source,
            confidence: 1.0
          });
        }
      }
      links.push({
        id: `payor_link_${uuidv4()}`,
        entity_id: entityId,
        source_record_id: m.source_record_id,
        decision_id: m.decision_id
      });
    }
  }

  db.upsertPayorCanonicalEntities(entities);
  db.upsertPayorEntityAliases(aliases);
  db.upsertPayorEntityLinks(links);

  return {
    policy_version: policyVersion || 'active',
    decisions_scanned: rows.length,
    canonical_entities_upserted: entities.length,
    aliases_upserted: aliases.length,
    links_upserted: links.length
  };
}

function backfillFromInsurancePayers({ limit = 5000 } = {}) {
  const rows = db.backfillCanonicalFromInsurancePayers(limit);
  const entities = [];
  const aliases = [];
  for (const row of rows) {
    const entityId = `payor_entity_bridge_${uuidv4()}`;
    entities.push({
      id: entityId,
      canonical_name: row.payer_name || row.payer_id,
      canonical_payer_id: row.payer_id || null,
      status: 'active'
    });
    const names = new Set([row.payer_name, ...(Array.isArray(row.aliases) ? row.aliases : [])].filter(Boolean));
    for (const name of names) {
      aliases.push({
        id: `payor_alias_bridge_${uuidv4()}`,
        entity_id: entityId,
        alias: name,
        alias_normalized: normalizeAlias(name),
        source: 'insurance_payers_bridge',
        confidence: 0.8
      });
    }
  }
  db.upsertPayorCanonicalEntities(entities);
  db.upsertPayorEntityAliases(aliases);
  return { bridge_rows_scanned: rows.length, bridge_entities_upserted: entities.length, bridge_aliases_upserted: aliases.length };
}

function resolveCanonicalByAlias(input) {
  const normalized = normalizeAlias(input);
  if (!normalized) return null;
  const entity = db.db.prepare(`
    SELECT e.*
    FROM payor_entity_aliases a
    JOIN payor_canonical_entities e ON e.id = a.entity_id
    WHERE a.alias_normalized = ?
    ORDER BY a.confidence DESC, e.updated_at DESC
    LIMIT 1
  `).get(normalized);
  if (entity) return { source: 'canonical', entity };

  // Compatibility read-path during migration window.
  const legacy = db.searchCachedPayers(input);
  if (Array.isArray(legacy) && legacy.length > 0) {
    return {
      source: 'legacy_insurance_payers',
      legacy: legacy[0]
    };
  }
  return null;
}

module.exports = {
  SOURCE_PRECEDENCE,
  normalizeAlias,
  buildCanonicalEntities,
  backfillFromInsurancePayers,
  resolveCanonicalByAlias
};

