#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../../database');

function normalizeName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeLegalSuffixes(v) {
  const suffixes = new Set([
    'inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'co', 'pllc', 'pc', 'lp', 'llp'
  ]);
  const tokens = normalizeName(v).split(' ').filter(Boolean);
  while (tokens.length && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function nameVariants(values = []) {
  const out = new Set();
  for (const v of values) {
    const base = normalizeName(v);
    if (base) out.add(base);
    const stripped = removeLegalSuffixes(v);
    if (stripped) out.add(stripped);
    const compact = stripped.replace(/\s+/g, ' ');
    if (compact) out.add(compact);
  }
  return Array.from(out).filter(Boolean);
}

function soundex(input) {
  const s = String(input || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';
  const first = s[0];
  const map = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6'
  };
  let out = first;
  let prev = map[first] || '';
  for (let i = 1; i < s.length && out.length < 4; i += 1) {
    const c = s[i];
    const code = map[c] || '0';
    if (code !== '0' && code !== prev) out += code;
    prev = code;
  }
  return (out + '000').slice(0, 4);
}

function chooseTargetEntity(payerName, aliasList) {
  const variants = nameVariants([payerName, ...aliasList]);
  if (!variants.length) return null;

  for (const n of variants) {
    const exactEntity = db.db.prepare(`
      SELECT id, canonical_name
      FROM payor_canonical_entities
      WHERE lower(trim(canonical_name)) = ?
      LIMIT 1
    `).get(n);
    if (exactEntity) return { method: 'exact_name', entity: exactEntity };
  }

  for (const n of variants) {
    const aliasEntity = db.db.prepare(`
      SELECT e.id, e.canonical_name
      FROM payor_entity_aliases a
      JOIN payor_canonical_entities e ON e.id = a.entity_id
      WHERE a.alias_normalized = ?
      LIMIT 1
    `).get(n);
    if (aliasEntity) return { method: 'exact_alias', entity: aliasEntity };
  }

  // Conservative fuzzy: unique candidate by prefix_key.
  for (const n of variants) {
    const keyBase = n.replace(/\s+/g, '');
    const prefixKey = keyBase.slice(0, 6);
    if (!prefixKey) continue;
    const rows = db.db.prepare(`
      SELECT DISTINCT l.entity_id AS id, e.canonical_name
      FROM payor_normalized_records n
      JOIN payor_entity_links l ON l.source_record_id = n.source_record_id
      JOIN payor_canonical_entities e ON e.id = l.entity_id
      WHERE n.prefix_key = ?
      LIMIT 3
    `).all(prefixKey);
    if (rows.length === 1) return { method: 'fuzzy_prefix_unique', entity: rows[0] };
  }

  // Conservative fuzzy: unique candidate by soundex.
  for (const n of variants) {
    const sx = soundex(n);
    if (!sx) continue;
    const rows = db.db.prepare(`
      SELECT DISTINCT l.entity_id AS id, e.canonical_name
      FROM payor_normalized_records n
      JOIN payor_entity_links l ON l.source_record_id = n.source_record_id
      JOIN payor_canonical_entities e ON e.id = l.entity_id
      WHERE n.soundex_key = ?
      LIMIT 3
    `).all(sx);
    if (rows.length === 1) return { method: 'fuzzy_soundex_unique', entity: rows[0] };
  }

  return null;
}

function main() {
  const payers = db.db.prepare(`
    SELECT id, payer_id, payer_name, aliases
    FROM insurance_payers
    WHERE is_active = 1
    ORDER BY payer_name
  `).all();

  const aliasRows = [];
  let matched = 0;
  let unmatched = 0;
  let conflicts = 0;
  const byMethod = {};

  for (const p of payers) {
    let aliasList = [];
    try { aliasList = JSON.parse(p.aliases || '[]'); } catch (_) { aliasList = []; }
    if (!Array.isArray(aliasList)) aliasList = [];

    const target = chooseTargetEntity(p.payer_name, aliasList);
    if (!target) {
      unmatched += 1;
      continue;
    }

    const current = db.db.prepare(`
      SELECT canonical_payer_id
      FROM payor_canonical_entities
      WHERE id = ?
      LIMIT 1
    `).get(target.entity.id);
    const existing = String(current?.canonical_payer_id || '').trim();
    if (existing && existing !== p.payer_id) {
      conflicts += 1;
      continue;
    }

    db.db.prepare(`
      UPDATE payor_canonical_entities
      SET canonical_payer_id = ?, updated_at = ?
      WHERE id = ?
    `).run(p.payer_id, new Date().toISOString(), target.entity.id);

    const names = new Set([p.payer_name, ...aliasList].filter(Boolean));
    for (const n of names) {
      const norm = normalizeName(n);
      if (!norm) continue;
      aliasRows.push({
        id: `payor_alias_bridge_${uuidv4()}`,
        entity_id: target.entity.id,
        alias: n,
        alias_normalized: norm,
        source: 'insurance_payers_bridge',
        confidence: 0.95
      });
    }
    matched += 1;
    byMethod[target.method] = (byMethod[target.method] || 0) + 1;
  }

  db.upsertPayorEntityAliases(aliasRows);

  console.log(JSON.stringify({
    event: 'payor_bridge_insurance_payers_completed',
    insurance_payers_total: payers.length,
    matched,
    unmatched,
    conflicts,
    match_methods: byMethod,
    aliases_upserted: aliasRows.length,
    canonical_entities_with_payer_id: db.db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM payor_canonical_entities
      WHERE canonical_payer_id IS NOT NULL AND trim(canonical_payer_id) <> ''
    `).get().cnt
  }, null, 2));
}

main();
