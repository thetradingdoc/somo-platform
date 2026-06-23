#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { normalizeAlias } = require('../services/payor/payor-canonicalization-service');

function toNetworkStatus(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('in') && v.includes('network')) return 'in_network';
  if (v.includes('out') && v.includes('network')) return 'out_of_network';
  if (v.includes('participat')) return 'in_network';
  if (v.includes('non-participat')) return 'out_of_network';
  return 'unknown';
}

function computeConfidence({ networkStatus, providerSource, payorAliasMatched }) {
  let score = 0.55;
  if (networkStatus === 'in_network' || networkStatus === 'out_of_network') score += 0.2;
  if (providerSource === 'nppes_provider_api') score += 0.15;
  if (payorAliasMatched) score += 0.1;
  return Math.min(0.99, Number(score.toFixed(3)));
}

function parseSourceConfidence(payloadJson) {
  if (!payloadJson) return null;
  try {
    const payload = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
    const raw = payload?.source_confidence ?? payload?.confidence ?? payload?.confidence_score ?? null;
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(1, Number(n.toFixed(3))));
  } catch (_) {
    return null;
  }
}

function runLinker() {
  const rows = db.db.prepare(`
    SELECT id, provider_npi, payer_hint, network_status, effective_start_date, effective_end_date, source, payload_json
    FROM provider_network_source_records
    WHERE provider_npi IS NOT NULL AND TRIM(provider_npi) <> ''
      AND payer_hint IS NOT NULL AND TRIM(payer_hint) <> ''
    ORDER BY created_at DESC
    LIMIT 50000
  `).all();

  const providerByNpiStmt = db.db.prepare(`
    SELECT p.id, GROUP_CONCAT(DISTINCT l.source) AS provider_sources
    FROM provider_registry_entities p
    LEFT JOIN provider_registry_source_links l ON l.provider_entity_id = p.id
    WHERE canonical_npi = ?
      AND p.status = 'active'
    GROUP BY p.id
    LIMIT 1
  `);
  const payorByAliasStmt = db.db.prepare(`
    SELECT e.id
    FROM payor_entity_aliases a
    JOIN payor_canonical_entities e ON e.id = a.entity_id
    WHERE a.alias_normalized = ?
      AND e.status = 'active'
    ORDER BY a.confidence DESC, e.updated_at DESC
    LIMIT 1
  `);
  const upsertNetworkStmt = db.db.prepare(`
    INSERT INTO provider_payer_networks (
      id, provider_entity_id, payor_entity_id, network_status, effective_start_date,
      effective_end_date, confidence, source, provenance_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT
    DO UPDATE SET
      confidence = excluded.confidence,
      provenance_json = excluded.provenance_json,
      updated_at = excluded.updated_at
  `);

  let linked = 0;
  let missingProvider = 0;
  let missingPayor = 0;
  let orphanSourceRows = 0;
  const tx = db.db.transaction(() => {
    for (const row of rows) {
      const provider = providerByNpiStmt.get(String(row.provider_npi).trim());
      if (!provider) {
        missingProvider++;
        orphanSourceRows++;
        continue;
      }
      const normalizedPayor = normalizeAlias(row.payer_hint || '');
      const payor = normalizedPayor ? payorByAliasStmt.get(normalizedPayor) : null;
      if (!payor) {
        missingPayor++;
        continue;
      }

      const now = new Date().toISOString();
      const normalizedStatus = toNetworkStatus(row.network_status);
      const providerSources = String(provider.provider_sources || '').split(',').filter(Boolean);
      const providerSource = providerSources.includes('nppes_provider_api') ? 'nppes_provider_api' : (providerSources[0] || 'unknown');
      const computedConfidence = computeConfidence({
        networkStatus: normalizedStatus,
        providerSource,
        payorAliasMatched: Boolean(normalizedPayor)
      });
      const sourceConfidence = parseSourceConfidence(row.payload_json);
      const confidence = sourceConfidence != null ? sourceConfidence : computedConfidence;
      upsertNetworkStmt.run(
        `prov_payor_net_${uuidv4()}`,
        provider.id,
        payor.id,
        normalizedStatus,
        row.effective_start_date || null,
        row.effective_end_date || null,
        confidence,
        row.source || null,
        JSON.stringify({
          network_source_record_id: row.id,
          provider_npi: row.provider_npi,
          payor_entity_id: payor.id,
          normalized_payor_hint: normalizedPayor,
          normalized_network_status: normalizedStatus,
          confidence_factors: {
            provider_source: providerSource,
            payor_alias_match: Boolean(normalizedPayor)
          },
          payer_hint: row.payer_hint,
          source_payload: row.payload_json ? true : false
        }),
        now,
        now
      );
      linked++;
    }
  });

  tx();
  console.log(JSON.stringify({
    event: 'provider_network_linker_completed',
    scanned_rows: rows.length,
    linked_rows: linked,
    missing_provider_matches: missingProvider,
    missing_payor_matches: missingPayor,
    orphan_source_rows: orphanSourceRows
  }, null, 2));
  return {
    scanned_rows: rows.length,
    linked_rows: linked,
    missing_provider_matches: missingProvider,
    missing_payor_matches: missingPayor,
    orphan_source_rows: orphanSourceRows
  };
}

if (require.main === module) {
  runLinker();
}

module.exports = {
  runLinker
};

