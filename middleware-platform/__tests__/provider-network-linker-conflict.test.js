const db = require('../database');
const { runLinker } = require('../scripts/run-provider-network-linker.cjs');

function resetFixtures() {
  db.db.exec(`
    DELETE FROM provider_credentialing_artifacts;
    DELETE FROM provider_credentialing_profiles;
    DELETE FROM provider_payer_networks;
    DELETE FROM provider_network_source_records;
    DELETE FROM provider_registry_aliases;
    DELETE FROM provider_taxonomy_links;
    DELETE FROM provider_registry_source_links;
    DELETE FROM provider_registry_entities;
    DELETE FROM payor_entity_aliases;
    DELETE FROM payor_canonical_entities;
  `);
}

function seedCoreEntities() {
  const now = new Date().toISOString();
  db.db.prepare(`
    INSERT INTO provider_registry_entities (id, canonical_npi, first_name, last_name, provider_type, status, created_at, updated_at)
    VALUES ('prov_conflict', '7777777777', 'Conflict', 'Provider', 'individual', 'active', ?, ?)
  `).run(now, now);
  db.db.prepare(`
    INSERT INTO payor_canonical_entities (id, canonical_name, canonical_payer_id, status, created_at, updated_at)
    VALUES ('payor_conflict', 'Acme Health', 'P-CONFLICT', 'active', ?, ?)
  `).run(now, now);
  db.db.prepare(`
    INSERT INTO payor_entity_aliases (id, entity_id, alias, alias_normalized, source, confidence, created_at)
    VALUES ('alias_conflict', 'payor_conflict', 'Acme Health', 'acme health', 'test', 1.0, ?)
  `).run(now);
  db.db.prepare(`
    INSERT INTO provider_registry_source_links (id, provider_entity_id, source_record_id, source, provenance_json, created_at)
    VALUES ('prov_link_src', 'prov_conflict', 'seed_src', 'nppes_provider_api', '{}', ?)
  `).run(now);
}

function seedNetworkSourceRow({
  id,
  status,
  confidence,
  effectiveStartDate
}) {
  const now = new Date().toISOString();
  db.db.prepare(`
    INSERT INTO provider_network_source_records (
      id, source, source_record_id, provider_npi, payer_hint, network_name, network_status,
      effective_start_date, effective_end_date, payload_json, created_at
    ) VALUES (?, 'cms_ma_provider_directory', ?, '7777777777', 'Acme Health', 'Acme', ?, ?, NULL, ?, ?)
  `).run(
    id,
    `src_${id}`,
    status,
    effectiveStartDate,
    JSON.stringify({ source_confidence: confidence }),
    now
  );
}

describe('provider network linker conflict resolution', () => {
  beforeEach(() => {
    resetFixtures();
    seedCoreEntities();
  });

  test('resolves status conflict by preferring highest confidence + most recent', () => {
    seedNetworkSourceRow({
      id: 'snap_a',
      status: 'in_network',
      confidence: 0.9,
      effectiveStartDate: '2025-01-01'
    });
    seedNetworkSourceRow({
      id: 'snap_b',
      status: 'out_of_network',
      confidence: 0.6,
      effectiveStartDate: '2024-06-01'
    });

    runLinker();

    const canonical = db.db.prepare(`
      SELECT network_status, confidence, effective_start_date
      FROM provider_payer_networks
      WHERE provider_entity_id = 'prov_conflict'
        AND payor_entity_id = 'payor_conflict'
      ORDER BY COALESCE(confidence, 0) DESC, COALESCE(date(effective_start_date), date('1900-01-01')) DESC, updated_at DESC
      LIMIT 1
    `).get();
    expect(canonical.network_status).toBe('in_network');
    expect(Number(canonical.confidence)).toBeCloseTo(0.9, 3);

    const drift = db.db.prepare(`
      SELECT provider_entity_id, payor_entity_id, COUNT(DISTINCT network_status) AS status_variants
      FROM provider_payer_networks
      GROUP BY provider_entity_id, payor_entity_id
      HAVING COUNT(DISTINCT network_status) > 1
    `).all();
    expect(drift).toHaveLength(1);
    expect(drift[0].status_variants).toBe(2);
  });

  test('flags status drift when confidence is equal and dates differ; most recent wins', () => {
    seedNetworkSourceRow({
      id: 'snap_c',
      status: 'in_network',
      confidence: 0.8,
      effectiveStartDate: '2025-06-01'
    });
    seedNetworkSourceRow({
      id: 'snap_d',
      status: 'out_of_network',
      confidence: 0.8,
      effectiveStartDate: '2025-01-01'
    });

    runLinker();

    const canonical = db.db.prepare(`
      SELECT network_status, confidence, effective_start_date
      FROM provider_payer_networks
      WHERE provider_entity_id = 'prov_conflict'
        AND payor_entity_id = 'payor_conflict'
      ORDER BY COALESCE(confidence, 0) DESC, COALESCE(date(effective_start_date), date('1900-01-01')) DESC, updated_at DESC
      LIMIT 1
    `).get();
    expect(canonical.network_status).toBe('in_network');
    expect(Number(canonical.confidence)).toBeCloseTo(0.8, 3);
    expect(canonical.effective_start_date).toBe('2025-06-01');

    const drift = db.db.prepare(`
      SELECT provider_entity_id, payor_entity_id, COUNT(DISTINCT network_status) AS status_variants
      FROM provider_payer_networks
      GROUP BY provider_entity_id, payor_entity_id
      HAVING COUNT(DISTINCT network_status) > 1
    `).all();
    expect(drift).toHaveLength(1);
    expect(drift[0].status_variants).toBe(2);
  });
});

