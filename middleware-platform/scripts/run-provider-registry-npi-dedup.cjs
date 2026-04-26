#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function normalizeAlias(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceRank(source) {
  if (source === 'nppes_provider_api') return 100;
  if (source === 'inovalon_provider') return 80;
  return 10;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_) {
    return {};
  }
}

function pickProviderNames(payload = {}) {
  const basic = payload.basic || {};
  const first = basic.first_name || payload.first_name || null;
  const middle = basic.middle_name || payload.middle_name || null;
  const last = basic.last_name || payload.last_name || null;
  const org = basic.organization_name || payload.organization_name || null;
  return { first, middle, last, org };
}

function pickProviderTaxonomies(payload = {}) {
  const taxonomies = Array.isArray(payload.taxonomies) ? payload.taxonomies : [];
  return taxonomies
    .map((t) => ({
      code: t?.code ? String(t.code).trim() : '',
      primary: t?.primary === true || t?.primary === 'Y' || t?.primary === '1'
    }))
    .filter((t) => t.code);
}

function buildNuccTaxonomyMap() {
  const rows = db.db.prepare(`
    SELECT payload_json
    FROM payor_source_records
    WHERE source = 'nucc_csv'
    ORDER BY created_at DESC
    LIMIT 50000
  `).all();
  const map = new Map();
  for (const row of rows) {
    const payload = safeJsonParse(row.payload_json);
    const code = String(payload?.Code || payload?.code || '').trim();
    if (!code || map.has(code)) continue;
    map.set(code, {
      taxonomy_group: payload?.Classification || payload?.classification || payload?.Grouping || payload?.grouping || null
    });
  }
  return map;
}

function buildAliasCandidates({ names, rawName }) {
  const out = new Set();
  if (rawName) out.add(String(rawName).trim());
  const fullName = [names.first, names.middle, names.last].filter(Boolean).join(' ').trim();
  if (fullName) out.add(fullName);
  const shortName = [names.first, names.last].filter(Boolean).join(' ').trim();
  if (shortName) out.add(shortName);
  if (names.org) out.add(String(names.org).trim());
  return Array.from(out).filter(Boolean);
}

function run({ limit = 50000 } = {}) {
  const rows = db.db.prepare(`
    SELECT id, source, source_record_id, raw_npi, raw_name, payload_json, created_at
    FROM payor_source_records
    WHERE source IN ('nppes_provider_api', 'inovalon_provider')
      AND raw_npi IS NOT NULL
      AND TRIM(raw_npi) <> ''
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(limit);
  const nuccTaxonomyByCode = buildNuccTaxonomyMap();

  const byNpi = new Map();
  const rowsByNpi = new Map();
  for (const row of rows) {
    const npi = String(row.raw_npi || '').trim();
    if (!npi) continue;
    if (!byNpi.has(npi)) byNpi.set(npi, row);
    if (!rowsByNpi.has(npi)) rowsByNpi.set(npi, []);
    rowsByNpi.get(npi).push(row);
  }

  let entitiesUpserted = 0;
  let linksUpserted = 0;
  let aliasesUpserted = 0;
  let taxonomyLinksUpserted = 0;

  const upsertEntityStmt = db.db.prepare(`
    INSERT INTO provider_registry_entities (
      id, canonical_npi, first_name, middle_name, last_name, organization_name, provider_type, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(canonical_npi) DO UPDATE SET
      first_name = COALESCE(excluded.first_name, provider_registry_entities.first_name),
      middle_name = COALESCE(excluded.middle_name, provider_registry_entities.middle_name),
      last_name = COALESCE(excluded.last_name, provider_registry_entities.last_name),
      organization_name = COALESCE(excluded.organization_name, provider_registry_entities.organization_name),
      provider_type = COALESCE(excluded.provider_type, provider_registry_entities.provider_type),
      updated_at = excluded.updated_at
  `);
  const getEntityByNpiStmt = db.db.prepare(`
    SELECT id, canonical_npi
    FROM provider_registry_entities
    WHERE canonical_npi = ?
    LIMIT 1
  `);
  const upsertLinkStmt = db.db.prepare(`
    INSERT INTO provider_registry_source_links (
      id, provider_entity_id, source_record_id, source, provenance_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_entity_id, source, source_record_id) DO UPDATE SET
      provenance_json = excluded.provenance_json
  `);
  const upsertAliasStmt = db.db.prepare(`
    INSERT INTO provider_registry_aliases (
      id, provider_entity_id, alias, alias_normalized, confidence, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_entity_id, alias_normalized) DO UPDATE SET
      confidence = excluded.confidence,
      source = excluded.source
  `);
  const upsertTaxonomyStmt = db.db.prepare(`
    INSERT INTO provider_taxonomy_links (
      id, provider_entity_id, nucc_code, taxonomy_group, primary_flag, source, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_entity_id, nucc_code, source) DO UPDATE SET
      taxonomy_group = COALESCE(excluded.taxonomy_group, provider_taxonomy_links.taxonomy_group),
      primary_flag = excluded.primary_flag,
      confidence = excluded.confidence
  `);

  const tx = db.db.transaction(() => {
    for (const [npi] of byNpi.entries()) {
      const now = new Date().toISOString();
      const linkedRows = (rowsByNpi.get(npi) || []).slice();
      linkedRows.sort((a, b) => {
        const rankDiff = sourceRank(b.source) - sourceRank(a.source);
        if (rankDiff !== 0) return rankDiff;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
      const bestRow = linkedRows[0];
      const bestPayload = safeJsonParse(bestRow?.payload_json);
      const names = pickProviderNames(bestPayload);
      const providerType = names.org ? 'organization' : 'individual';

      const provisionalEntityId = `prov_ent_${uuidv4()}`;
      upsertEntityStmt.run(
        provisionalEntityId,
        npi,
        names.first,
        names.middle,
        names.last,
        names.org || bestRow?.raw_name || null,
        providerType,
        now,
        now
      );
      entitiesUpserted++;
      const entity = getEntityByNpiStmt.get(npi);
      if (!entity) continue;

      for (const r of linkedRows) {
        const rowPayload = safeJsonParse(r.payload_json);
        const rowNames = pickProviderNames(rowPayload);
        upsertLinkStmt.run(
          `prov_src_${uuidv4()}`,
          entity.id,
          r.id,
          r.source,
          JSON.stringify({ source_record_id: r.source_record_id, raw_name: r.raw_name }),
          now
        );
        linksUpserted++;

        const aliasCandidates = buildAliasCandidates({ names: rowNames, rawName: r.raw_name });
        for (const alias of aliasCandidates) {
          const norm = normalizeAlias(alias);
          if (norm) {
            upsertAliasStmt.run(
              `prov_alias_${uuidv4()}`,
              entity.id,
              alias,
              norm,
              1.0,
              r.source,
              now
            );
            aliasesUpserted++;
          }
        }

        const taxonomies = pickProviderTaxonomies(rowPayload);
        for (const tax of taxonomies) {
          const nuccEvidence = nuccTaxonomyByCode.get(tax.code) || {};
          upsertTaxonomyStmt.run(
            `prov_tax_${uuidv4()}`,
            entity.id,
            tax.code,
            nuccEvidence.taxonomy_group || null,
            tax.primary ? 1 : 0,
            'nucc_csv',
            1.0,
            now
          );
          taxonomyLinksUpserted++;
        }
      }
    }
  });

  tx();
  return {
    scanned_provider_rows: rows.length,
    distinct_npi_count: byNpi.size,
    provider_entities_upserted: entitiesUpserted,
    provider_source_links_upserted: linksUpserted,
    provider_aliases_upserted: aliasesUpserted,
    provider_taxonomy_links_upserted: taxonomyLinksUpserted
  };
}

if (require.main === module) {
  const out = run();
  console.log(JSON.stringify({ event: 'provider_registry_npi_dedup_completed', ...out }, null, 2));
}

module.exports = {
  run
};

