#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../../database');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function normAlias(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const batchSize = Math.max(100, Math.min(Number(getArg('batch', '5000')) || 5000, 20000));
const maxRows = Number(getArg('max', '0')) || 0;
const logEvery = Math.max(1, Number(getArg('log-every', '20')) || 20);

let offset = Math.max(0, Number(getArg('offset', '0')) || 0);
let processed = 0;
let entitiesUpserted = 0;
let aliasesUpserted = 0;
let linksUpserted = 0;
let batches = 0;

while (true) {
  const rows = db.db.prepare(`
    SELECT
      n.id AS normalized_id,
      n.normalized_name,
      n.source_record_id,
      s.source,
      s.raw_name,
      s.raw_payer_id,
      s.raw_npi,
      s.raw_ein,
      s.raw_state_hint
    FROM payor_normalized_records n
    JOIN payor_source_records s ON s.id = n.source_record_id
    ORDER BY n.id
    LIMIT ? OFFSET ?
  `).all(batchSize, offset);

  if (!rows.length) break;

  const entities = [];
  const aliases = [];
  const links = [];

  for (const r of rows) {
    const entityId = `payor_entity_norm_${r.normalized_id}`;
    entities.push({
      id: entityId,
      canonical_name: r.normalized_name || r.raw_name || `payor_${String(r.normalized_id).slice(-8)}`,
      canonical_payer_id: r.raw_payer_id || null,
      canonical_npi: r.raw_npi || null,
      canonical_ein: r.raw_ein || null,
      state_scope: r.raw_state_hint || null,
      status: 'active'
    });

    const aliasesForRow = [r.raw_name, r.normalized_name].filter(Boolean);
    for (const a of aliasesForRow) {
      const norm = normAlias(a);
      if (!norm) continue;
      aliases.push({
        id: `payor_alias_norm_${r.normalized_id}_${norm.slice(0, 24).replace(/\s+/g, '_')}`,
        entity_id: entityId,
        alias: a,
        alias_normalized: norm,
        source: r.source || 'normalized_bootstrap',
        confidence: 0.6
      });
    }

    links.push({
      id: `payor_link_norm_${r.normalized_id}`,
      entity_id: entityId,
      source_record_id: r.source_record_id,
      decision_id: null
    });
  }

  entitiesUpserted += db.upsertPayorCanonicalEntities(entities);
  aliasesUpserted += db.upsertPayorEntityAliases(aliases);
  linksUpserted += db.upsertPayorEntityLinks(links);
  processed += rows.length;
  offset += rows.length;
  batches += 1;

  if (batches % logEvery === 0) {
    console.log(JSON.stringify({
      event: 'payor_canonical_bootstrap_progress',
      batches,
      offset,
      processed_rows: processed,
      entities_upserted: entitiesUpserted,
      aliases_upserted: aliasesUpserted,
      links_upserted: linksUpserted
    }));
  }

  if (maxRows > 0 && processed >= maxRows) break;
}

console.log(JSON.stringify({
  event: 'payor_canonical_bootstrap_from_normalized_completed',
  processed_rows: processed,
  canonical_entities_upserted: entitiesUpserted,
  aliases_upserted: aliasesUpserted,
  links_upserted: linksUpserted,
  totals: db.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM payor_canonical_entities) AS entities_total,
      (SELECT COUNT(*) FROM payor_entity_aliases) AS aliases_total,
      (SELECT COUNT(*) FROM payor_entity_links) AS links_total
  `).get()
}, null, 2));
