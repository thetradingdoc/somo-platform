const db = require('../database');
const { DEFAULT_SOURCES, buildBlockingCandidates } = require('../services/payor-blocking-service');

function resetBlockingFixtures() {
  db.db.exec(`
    DELETE FROM payor_match_candidates;
    DELETE FROM payor_normalized_records;
    DELETE FROM payor_source_records;
    DELETE FROM payor_ingest_batches;
  `);
}

function seedNormalizedFixture(items) {
  const now = new Date().toISOString();
  const insertBatch = db.db.prepare(`
    INSERT INTO payor_ingest_batches (id, source, file_name, file_checksum, status, created_at, started_at)
    VALUES (?, ?, ?, ?, 'completed', ?, ?)
  `);
  const insertSource = db.db.prepare(`
    INSERT INTO payor_source_records (
      id, batch_id, source, source_record_id, raw_name, raw_payer_id, raw_npi, raw_ein, raw_state_hint, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNorm = db.db.prepare(`
    INSERT INTO payor_normalized_records (
      id, source_record_id, source, normalized_name, normalized_tokens_json, canonical_tokens_json,
      stripped_state, soundex_key, prefix_key, normalization_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?)
  `);
  const tx = db.db.transaction((rows) => {
    const createdBatches = new Set();
    for (const r of rows) {
      const batchId = `batch_${r.source}`;
      if (!createdBatches.has(batchId)) {
        insertBatch.run(batchId, r.source, `${r.source}.csv`, `${r.source}_chk`, now, now);
        createdBatches.add(batchId);
      }
      insertSource.run(
        r.sourceRecordId,
        batchId,
        r.source,
        r.sourceRecordId,
        r.rawName || r.normalizedName,
        r.rawPayerId || null,
        r.rawNpi || null,
        r.rawEin || null,
        null,
        JSON.stringify({}),
        now
      );
      insertNorm.run(
        r.normalizedId,
        r.sourceRecordId,
        r.source,
        r.normalizedName,
        JSON.stringify([r.normalizedName]),
        JSON.stringify([r.normalizedName]),
        null,
        r.soundexKey || '',
        r.prefixKey || '',
        now,
        now
      );
    }
  });
  tx(items);
}

describe('payor blocking service scaffolding', () => {
  beforeEach(() => {
    resetBlockingFixtures();
  });

  test('default blocking source list includes tier-1 payer sources (Office Ally present when data exists)', () => {
    expect(DEFAULT_SOURCES).toEqual(
      expect.arrayContaining(['inovalon', 'office_ally', 'nppes_bulk', 'nppes_api', 'nucc_csv', 'cms_ma_plan_directory'])
    );
  });

  test('creates hard-match candidate for cross-source exact payer_id', () => {
    seedNormalizedFixture([
      {
        normalizedId: 'norm_a',
        sourceRecordId: 'src_a',
        source: 'inovalon',
        normalizedName: 'acme health',
        rawPayerId: 'P123'
      },
      {
        normalizedId: 'norm_b',
        sourceRecordId: 'src_b',
        source: 'nppes_api',
        normalizedName: 'acme health plan',
        rawPayerId: 'P123'
      }
    ]);

    const out = buildBlockingCandidates({
      sources: ['inovalon', 'nppes_api'],
      normalizationVersion: 'v1',
      maxBucketSize: 10,
      enforceCrossSourceOnly: true
    });

    expect(out.candidate_pair_count).toBe(1);
    expect(out.hard_match_candidate_count).toBe(1);
    expect(out.by_block_key_type.find((x) => x.block_key_type === 'exact_payer_id')?.candidate_count).toBe(1);
    expect(out.same_source_pair_count).toBe(0);
  });

  test('enforces cross-source policy and excludes same-source matches', () => {
    seedNormalizedFixture([
      {
        normalizedId: 'norm_c1',
        sourceRecordId: 'src_c1',
        source: 'inovalon',
        normalizedName: 'alpha health',
        rawPayerId: 'PX1'
      },
      {
        normalizedId: 'norm_c2',
        sourceRecordId: 'src_c2',
        source: 'inovalon',
        normalizedName: 'alpha health inc',
        rawPayerId: 'PX1'
      },
      {
        normalizedId: 'norm_c3',
        sourceRecordId: 'src_c3',
        source: 'nppes_api',
        normalizedName: 'alpha health system',
        rawPayerId: 'PX1'
      }
    ]);

    const out = buildBlockingCandidates({
      sources: ['inovalon', 'nppes_api'],
      normalizationVersion: 'v1',
      maxBucketSize: 10,
      enforceCrossSourceOnly: true
    });

    // only inovalon<->nppes_api pairs should remain (2 pairs)
    expect(out.candidate_pair_count).toBe(2);
    expect(out.same_source_pair_count).toBe(0);
    expect(out.by_source_pair_candidates.some((r) => r.source_pair === 'inovalon <-> inovalon')).toBe(false);
  });

  test('bucket cap drops oversized blocking keys', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      rows.push({
        normalizedId: `norm_d_ino_${i}`,
        sourceRecordId: `src_d_ino_${i}`,
        source: 'inovalon',
        normalizedName: `beta inovalon ${i}`,
        rawPayerId: 'CAP_KEY'
      });
      rows.push({
        normalizedId: `norm_d_npp_${i}`,
        sourceRecordId: `src_d_npp_${i}`,
        source: 'nppes_api',
        normalizedName: `beta nppes ${i}`,
        rawPayerId: 'CAP_KEY'
      });
    }
    seedNormalizedFixture(rows);

    const out = buildBlockingCandidates({
      sources: ['inovalon', 'nppes_api'],
      normalizationVersion: 'v1',
      maxBucketSize: 3, // lower than CAP_KEY bucket size (12), should drop
      enforceCrossSourceOnly: true
    });

    expect(out.candidate_pair_count).toBe(0);
    const drop = out.dropped_keys_by_block_type.find((r) => r.block_key_type === 'exact_payer_id');
    expect(drop).toBeDefined();
    expect(drop.dropped_keys).toBeGreaterThan(0);
  });
});

