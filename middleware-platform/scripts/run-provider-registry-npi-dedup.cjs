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
  if (source === 'nppes_directory') return 70;
  return 10;
}

function hasTable(name) {
  const r = db.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!r;
}

function parseDisplayName(displayName, entityTypeCode) {
  const raw = String(displayName || '').trim();
  if (!raw) return { first: null, middle: null, last: null, org: null };
  if (String(entityTypeCode) === '2') {
    return { first: null, middle: null, last: null, org: raw };
  }
  const comma = raw.indexOf(',');
  if (comma > 0) {
    const last = raw.slice(0, comma).trim();
    const rest = raw.slice(comma + 1).trim().split(/\s+/);
    return {
      first: rest[0] || null,
      middle: rest.length > 2 ? rest.slice(1, -1).join(' ') : rest[1] || null,
      last: rest.length > 1 ? rest[rest.length - 1] : last,
      org: null
    };
  }
  const parts = raw.split(/\s+/);
  if (parts.length === 1) return { first: null, middle: null, last: parts[0], org: null };
  return {
    first: parts[0],
    middle: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    last: parts[parts.length - 1],
    org: null
  };
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

function run({ limit = 50000, all = false } = {}) {
  const sql = `
    SELECT id, source, source_record_id, raw_npi, raw_name, payload_json, created_at
    FROM payor_source_records
    WHERE source IN ('nppes_provider_api', 'inovalon_provider')
      AND raw_npi IS NOT NULL
      AND TRIM(raw_npi) <> ''
    ORDER BY datetime(created_at) DESC
    ${all ? '' : 'LIMIT ?'}
  `;
  const rows = all ? db.db.prepare(sql).all() : db.db.prepare(sql).all(limit);
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

/**
 * Sync provider_registry + taxonomy from nppes_directory_providers (Type 1 + org).
 * Batched to avoid one giant transaction on ~1.7M rows.
 */
function runFromNppesDirectory({ limit = 50000, offset = 0, all = false } = {}) {
  if (!hasTable('nppes_directory_providers')) {
    return {
      scanned_directory_rows: 0,
      provider_entities_upserted: 0,
      provider_taxonomy_links_upserted: 0,
      skipped: 'nppes_directory_providers missing'
    };
  }

  const nuccTaxonomyByCode = buildNuccTaxonomyMap();
  const sql = `
    SELECT npi, entity_type_code, display_name, specialty_code, specialty_display
    FROM nppes_directory_providers
    WHERE specialty_code IS NOT NULL AND TRIM(specialty_code) <> ''
    ORDER BY npi
    LIMIT ? OFFSET ?
  `;

  let entitiesUpserted = 0;
  let taxonomyLinksUpserted = 0;
  let aliasesUpserted = 0;
  let scanned = 0;

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
    SELECT id, canonical_npi FROM provider_registry_entities WHERE canonical_npi = ? LIMIT 1
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

  let batchOffset = offset;
  const batchLimit = all ? 50000 : Math.min(limit, 50000);
  let keepGoing = true;

  while (keepGoing) {
    const rows = db.db.prepare(sql).all(batchLimit, batchOffset);
    if (!rows.length) break;
    scanned += rows.length;

    const tx = db.db.transaction(() => {
      for (const row of rows) {
        const npi = String(row.npi || '').trim();
        const taxCode = String(row.specialty_code || '').trim();
        if (!npi || !taxCode) continue;
        const now = new Date().toISOString();
        const names = parseDisplayName(row.display_name, row.entity_type_code);
        const providerType = String(row.entity_type_code) === '2' ? 'organization' : 'individual';
        upsertEntityStmt.run(
          `prov_ent_${uuidv4()}`,
          npi,
          names.first,
          names.middle,
          names.last,
          names.org || (providerType === 'organization' ? row.display_name : null),
          providerType,
          now,
          now
        );
        entitiesUpserted++;
        const entity = getEntityByNpiStmt.get(npi);
        if (!entity) continue;
        const norm = normalizeAlias(row.display_name);
        if (norm) {
          upsertAliasStmt.run(
            `prov_alias_${uuidv4()}`,
            entity.id,
            row.display_name,
            norm,
            0.9,
            'nppes_directory',
            now
          );
          aliasesUpserted++;
        }
        const nuccEvidence = nuccTaxonomyByCode.get(taxCode) || {};
        upsertTaxonomyStmt.run(
          `prov_tax_${uuidv4()}`,
          entity.id,
          taxCode,
          nuccEvidence.taxonomy_group || row.specialty_display || null,
          1,
          'nppes_directory',
          0.95,
          now
        );
        taxonomyLinksUpserted++;
      }
    });
    tx();

    if (!all || rows.length < batchLimit) {
      keepGoing = false;
    } else {
      batchOffset += rows.length;
      if (batchOffset % 100000 === 0) {
        console.log(`  [nppes_directory] offset=${batchOffset} entities=${entitiesUpserted} taxonomy=${taxonomyLinksUpserted}`);
      }
    }
  }

  return {
    scanned_directory_rows: scanned,
    directory_offset_end: batchOffset,
    provider_entities_upserted: entitiesUpserted,
    provider_aliases_upserted: aliasesUpserted,
    provider_taxonomy_links_upserted: taxonomyLinksUpserted
  };
}

if (require.main === module) {
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) || 50000 : 50000;
  const all = process.argv.includes('--all');
  const includeDirectory = process.argv.includes('--include-directory');
  const directoryAll = process.argv.includes('--directory-all');
  const dirOffsetIdx = process.argv.indexOf('--directory-offset');
  const directoryOffset = dirOffsetIdx >= 0 ? parseInt(process.argv[dirOffsetIdx + 1], 10) || 0 : 0;

  const out = run({ limit, all });
  const result = { event: 'provider_registry_npi_dedup_completed', payor_sources: out, all };

  if (includeDirectory || directoryAll) {
    result.nppes_directory = runFromNppesDirectory({
      limit: directoryAll ? 50000 : limit,
      offset: directoryOffset,
      all: directoryAll
    });
  }

  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  run,
  runFromNppesDirectory
};

