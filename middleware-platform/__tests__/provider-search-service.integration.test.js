const db = require('../database');
const { listProviderSearchResults } = require('../services/provider-search-service');

function resetFixtures() {
  db.db.exec(`
    DELETE FROM provider_credentialing_artifacts;
    DELETE FROM provider_credentialing_profiles;
    DELETE FROM provider_payer_networks;
    DELETE FROM provider_registry_aliases;
    DELETE FROM provider_taxonomy_links;
    DELETE FROM provider_registry_source_links;
    DELETE FROM provider_registry_entities;
    DELETE FROM payor_entity_aliases;
    DELETE FROM payor_canonical_entities;
    DELETE FROM payor_source_records;
    DELETE FROM payor_ingest_batches;
  `);
}

function seedData() {
  const now = new Date().toISOString();
  db.db.prepare(`
    INSERT INTO provider_registry_entities (id, canonical_npi, first_name, last_name, provider_type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'individual', 'active', ?, ?)
  `).run('prov_1', '4444444444', 'Alice', 'Derm', now, now);
  db.db.prepare(`
    INSERT INTO provider_registry_entities (id, canonical_npi, first_name, last_name, provider_type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'individual', 'active', ?, ?)
  `).run('prov_2', '5555555555', 'Bob', 'Cardio', now, now);

  db.db.prepare(`
    INSERT INTO provider_taxonomy_links (id, provider_entity_id, nucc_code, taxonomy_group, primary_flag, source, confidence, created_at)
    VALUES (?, ?, ?, ?, 1, 'nucc_csv', 1.0, ?)
  `).run('tax_1', 'prov_1', '207N00000X', 'Dermatology', now);
  db.db.prepare(`
    INSERT INTO provider_taxonomy_links (id, provider_entity_id, nucc_code, taxonomy_group, primary_flag, source, confidence, created_at)
    VALUES (?, ?, ?, ?, 1, 'nucc_csv', 1.0, ?)
  `).run('tax_2', 'prov_2', '207RC0000X', 'Cardiology', now);

  db.db.prepare(`
    INSERT INTO payor_canonical_entities (id, canonical_name, canonical_payer_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run('payor_1', 'Acme Health', 'P100', now, now);
  db.db.prepare(`
    INSERT INTO provider_payer_networks (id, provider_entity_id, payor_entity_id, network_status, confidence, source, provenance_json, created_at, updated_at)
    VALUES (?, ?, ?, 'in_network', 0.9, 'cms_ma_provider_directory', '{}', ?, ?)
  `).run('net_1', 'prov_1', 'payor_1', now, now);

  db.db.prepare(`
    INSERT INTO payor_ingest_batches (id, source, file_name, file_checksum, status, created_at, started_at)
    VALUES ('batch_provider_test', 'nppes_provider_api', 'x.csv', 'chk_provider_test', 'completed', ?, ?)
  `).run(now, now);
  db.db.prepare(`
    INSERT INTO payor_source_records (id, batch_id, source, source_record_id, raw_name, raw_payer_id, raw_npi, raw_ein, raw_state_hint, payload_json, created_at)
    VALUES (?, 'batch_provider_test', 'nppes_provider_api', ?, ?, NULL, ?, NULL, 'CA', ?, ?)
  `).run(
    'psr_1',
    'nppes_src_1',
    'Alice Derm',
    '4444444444',
    JSON.stringify({
      addresses: [{ address_purpose: 'LOCATION', city: 'Los Angeles', state: 'CA', latitude: 34.0522, longitude: -118.2437 }]
    }),
    now
  );
  db.db.prepare(`
    INSERT INTO provider_registry_source_links (id, provider_entity_id, source_record_id, source, provenance_json, created_at)
    VALUES (?, ?, ?, 'nppes_provider_api', '{}', ?)
  `).run('link_1', 'prov_1', 'psr_1', now);
}

describe('provider search service integration', () => {
  beforeEach(() => {
    resetFixtures();
    seedData();
  });

  test('filters by taxonomy, location radius, and optional payor', () => {
    const out = listProviderSearchResults({
      taxonomyCode: '207N00000X',
      latitude: 34.0522,
      longitude: -118.2437,
      radiusMiles: 15,
      payorEntityId: 'payor_1',
      page: 1,
      pageSize: 10
    });

    expect(out.providers).toHaveLength(1);
    expect(out.providers[0].provider_entity_id).toBe('prov_1');
    expect(out.providers[0].taxonomy_codes).toContain('207N00000X');
    expect(out.providers[0].distance_miles).toBe(0);
  });
});

