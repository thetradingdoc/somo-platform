#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

const TEST_CASES = [
  { provider_npi: 'NPI-TEST-001', payer_id: 'PAY-001', network_status: 'in_network', confidence: 0.2, effective_start: '2025-01-01', effective_end: '2026-01-01', source: 'cms_ma' },
  { provider_npi: 'NPI-TEST-002', payer_id: 'PAY-002', network_status: 'maybe_network', confidence: 0.8, effective_start: '2025-01-01', effective_end: '2026-01-01', source: 'cms_ma' },
  { provider_npi: 'NPI-TEST-003', payer_id: 'PAY-003', network_status: 'in_network', confidence: 0.85, effective_start: '2025-06-01', effective_end: '2024-01-01', source: 'cms_ma' },
  { provider_npi: 'NPI-TEST-004', payer_id: 'PAY-004', network_status: 'in_network', confidence: 0.9, effective_start: '2023-01-01', effective_end: null, updated_at: '2023-01-01T00:00:00Z', source: 'cms_ma' },
  { provider_npi: 'NPI-TEST-005', payer_id: 'PAY-005', network_status: 'in_network', confidence: 0.8, effective_start: '2025-06-01', source: 'cms_ma' },
  { provider_npi: 'NPI-TEST-005', payer_id: 'PAY-005', network_status: 'out_of_network', confidence: 0.75, effective_start: '2025-01-01', source: 'inovalon' },
  { provider_npi: 'NPI-TEST-006', payer_id: 'PAY-006', network_status: 'in_network', confidence: 0.92, effective_start: '2025-03-01', effective_end: '2026-03-01', source: 'cms_ma' },
  { provider_npi: 'NPI-TEST-007', payer_id: 'PAY-007', network_status: 'out_of_network', confidence: 0.88, effective_start: '2025-04-01', effective_end: '2026-04-01', source: 'inovalon' }
];

/**
 * Removes rows inserted by {@link seedProviderNetworkDriftTestData} so other Jest suites sharing SQLite are not blocked by FKs.
 * @param {import('better-sqlite3').Database} [sqlite]
 */
function cleanupProviderNetworkDriftTestData(sqlite = db.db) {
  const testNpis = [...new Set(TEST_CASES.map((x) => x.provider_npi))];
  const testPayers = [...new Set(TEST_CASES.map((x) => x.payer_id))];
  const tx = sqlite.transaction(() => {
    const placeholdersNpi = testNpis.map(() => '?').join(',');
    const providerIds = sqlite.prepare(`
      SELECT id FROM provider_registry_entities WHERE canonical_npi IN (${placeholdersNpi})
    `).all(...testNpis).map((r) => r.id);
    if (providerIds.length) {
      const p = providerIds.map(() => '?').join(',');
      sqlite.prepare(`DELETE FROM provider_payer_networks WHERE provider_entity_id IN (${p})`).run(...providerIds);
      sqlite.prepare(`DELETE FROM provider_credentialing_artifacts WHERE provider_entity_id IN (${p})`).run(...providerIds);
      sqlite.prepare(`DELETE FROM provider_credentialing_profiles WHERE provider_entity_id IN (${p})`).run(...providerIds);
      sqlite.prepare(`DELETE FROM provider_registry_aliases WHERE provider_entity_id IN (${p})`).run(...providerIds);
      sqlite.prepare(`DELETE FROM provider_taxonomy_links WHERE provider_entity_id IN (${p})`).run(...providerIds);
      sqlite.prepare(`DELETE FROM provider_registry_source_links WHERE provider_entity_id IN (${p})`).run(...providerIds);
      sqlite.prepare(`DELETE FROM provider_registry_entities WHERE id IN (${p})`).run(...providerIds);
    }
    const placeholdersPid = testPayers.map(() => '?').join(',');
    const payorIds = sqlite.prepare(`
      SELECT id FROM payor_canonical_entities WHERE canonical_payer_id IN (${placeholdersPid})
    `).all(...testPayers).map((r) => r.id);
    if (payorIds.length) {
      const p = payorIds.map(() => '?').join(',');
      sqlite.prepare(`DELETE FROM provider_payer_networks WHERE payor_entity_id IN (${p})`).run(...payorIds);
      sqlite.prepare(`DELETE FROM payor_entity_aliases WHERE entity_id IN (${p})`).run(...payorIds);
      sqlite.prepare(`DELETE FROM payor_canonical_entities WHERE id IN (${p})`).run(...payorIds);
    }
  });
  tx();
}

/**
 * @param {import('better-sqlite3').Database} [sqlite]
 * @returns {{ row_count: number, test_provider_npis: string[] }}
 */
function seedProviderNetworkDriftTestData(sqlite = db.db) {
  const now = new Date().toISOString();
  const testNpis = [...new Set(TEST_CASES.map((x) => x.provider_npi))];
  const testPayers = [...new Set(TEST_CASES.map((x) => x.payer_id))];

  const tx = sqlite.transaction(() => {
    cleanupProviderNetworkDriftTestData(sqlite);

    const upsertProvider = sqlite.prepare(`
      INSERT INTO provider_registry_entities (id, canonical_npi, first_name, last_name, provider_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'individual', 'active', ?, ?)
      ON CONFLICT(canonical_npi) DO UPDATE SET updated_at = excluded.updated_at
    `);
    const insertPayor = sqlite.prepare(`
      INSERT INTO payor_canonical_entities (id, canonical_name, canonical_payer_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
    `);
    const upsertAlias = sqlite.prepare(`
      INSERT INTO payor_entity_aliases (id, entity_id, alias, alias_normalized, source, confidence, created_at)
      VALUES (?, ?, ?, ?, 'drift_test_seed', 1.0, ?)
    `);
    const insertLink = sqlite.prepare(`
      INSERT INTO provider_payer_networks (
        id, provider_entity_id, payor_entity_id, network_status, effective_start_date, effective_end_date,
        confidence, source, provenance_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const providerByNpi = new Map();
    const payorByPid = new Map();
    for (const npi of testNpis) {
      const id = `prov_test_${uuidv4()}`;
      upsertProvider.run(id, npi, 'Test', npi, now, now);
      const fetched = sqlite.prepare(`SELECT id FROM provider_registry_entities WHERE canonical_npi = ?`).get(npi);
      providerByNpi.set(npi, fetched.id);
    }
    for (const pid of testPayers) {
      insertPayor.run(`payor_test_${uuidv4()}`, `Payor ${pid}`, pid, now, now);
      const fetched = sqlite.prepare(`
        SELECT id
        FROM payor_canonical_entities
        WHERE canonical_payer_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(pid);
      payorByPid.set(pid, fetched.id);
      upsertAlias.run(`alias_test_${uuidv4()}`, fetched.id, `Payor ${pid}`, `payor ${pid}`.toLowerCase(), now);
    }

    for (const row of TEST_CASES) {
      const providerEntityId = providerByNpi.get(row.provider_npi);
      const payorEntityId = payorByPid.get(row.payer_id);
      const updatedAt = row.updated_at || now;
      insertLink.run(
        `ppn_test_${uuidv4()}`,
        providerEntityId,
        payorEntityId,
        row.network_status,
        row.effective_start || null,
        row.effective_end || null,
        row.confidence,
        row.source || 'drift_test',
        JSON.stringify({ test_seed: true, provider_npi: row.provider_npi, payer_id: row.payer_id }),
        now,
        updatedAt
      );
    }
  });

  tx();
  return {
    row_count: TEST_CASES.length,
    test_provider_npis: [...new Set(TEST_CASES.map((r) => r.provider_npi))]
  };
}

function main() {
  const summary = seedProviderNetworkDriftTestData();
  console.log(JSON.stringify({
    event: 'provider_network_drift_test_seeded',
    ...summary
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { seedProviderNetworkDriftTestData, cleanupProviderNetworkDriftTestData, TEST_CASES };
