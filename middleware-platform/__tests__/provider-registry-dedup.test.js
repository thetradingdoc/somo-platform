const db = require('../database');
const { run } = require('../scripts/run-provider-registry-npi-dedup.cjs');

function resetProviderFixtures() {
  db.db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM provider_credentialing_artifacts;
    DELETE FROM provider_credentialing_profiles;
    DELETE FROM provider_payer_networks;
    DELETE FROM provider_registry_aliases;
    DELETE FROM provider_registry_source_links;
    DELETE FROM provider_taxonomy_links;
    DELETE FROM provider_registry_entities;
    DELETE FROM payor_source_records;
    DELETE FROM payor_ingest_batches;
    PRAGMA foreign_keys = ON;
  `);
}

function seedProviderSourceRows(rows) {
  const now = new Date().toISOString();
  const insertBatch = db.db.prepare(`
    INSERT INTO payor_ingest_batches (id, source, file_name, file_checksum, status, created_at, started_at)
    VALUES (?, ?, ?, ?, 'completed', ?, ?)
  `);
  const insertSource = db.db.prepare(`
    INSERT INTO payor_source_records (
      id, batch_id, source, source_record_id, raw_name, raw_payer_id,
      raw_npi, raw_ein, raw_state_hint, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const batches = new Set();
  for (const r of rows) {
    const batchId = `batch_${r.source}`;
    if (!batches.has(batchId)) {
      insertBatch.run(batchId, r.source, `${r.source}.csv`, `${r.source}_chk`, now, now);
      batches.add(batchId);
    }
    insertSource.run(
      r.id,
      batchId,
      r.source,
      r.sourceRecordId,
      r.rawName,
      null,
      r.rawNpi,
      null,
      null,
      JSON.stringify(r.payload || {}),
      now
    );
  }
}

describe('provider registry npi dedup', () => {
  beforeEach(() => {
    resetProviderFixtures();
  });

  test('golden: duplicate NPI resolves to a single provider entity', () => {
    seedProviderSourceRows([
      {
        id: 'src_a',
        source: 'nppes_provider_api',
        sourceRecordId: 'nppes_1',
        rawName: 'Jane Doe',
        rawNpi: '1111111111',
        payload: { basic: { first_name: 'Jane', last_name: 'Doe' }, taxonomies: [{ code: '207Q00000X', primary: true }] }
      },
      {
        id: 'src_b',
        source: 'inovalon_provider',
        sourceRecordId: 'ino_1',
        rawName: 'J. Doe',
        rawNpi: '1111111111',
        payload: { first_name: 'Jane', last_name: 'Doe' }
      }
    ]);

    const out = run({ limit: 1000 });
    expect(out.distinct_npi_count).toBe(1);

    const entities = db.db.prepare(`SELECT id FROM provider_registry_entities WHERE canonical_npi = ?`).all('1111111111');
    const links = db.db.prepare(`SELECT COUNT(*) AS n FROM provider_registry_source_links`).get();
    expect(entities.length).toBe(1);
    expect(links.n).toBe(2);
  });

  test('negative: distinct providers do not collapse across NPIs', () => {
    seedProviderSourceRows([
      {
        id: 'src_c',
        source: 'nppes_provider_api',
        sourceRecordId: 'nppes_2',
        rawName: 'John Smith',
        rawNpi: '2222222222',
        payload: { basic: { first_name: 'John', last_name: 'Smith' } }
      },
      {
        id: 'src_d',
        source: 'nppes_provider_api',
        sourceRecordId: 'nppes_3',
        rawName: 'John Smith',
        rawNpi: '3333333333',
        payload: { basic: { first_name: 'John', last_name: 'Smith' } }
      }
    ]);

    const out = run({ limit: 1000 });
    expect(out.distinct_npi_count).toBe(2);

    const entities = db.db.prepare(`
      SELECT canonical_npi FROM provider_registry_entities
      WHERE canonical_npi IN ('2222222222','3333333333')
    `).all();
    expect(entities).toHaveLength(2);
  });
});

