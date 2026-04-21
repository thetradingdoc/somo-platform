'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

const DEFAULT_SOURCES = ['inovalon', 'office_ally', 'nppes_api', 'nppes_bulk', 'cms_ma_plan_directory', 'nucc_csv', 'nucc'];
const PAYER_ER_EXCLUDED_SOURCES = new Set([
  'nucc_csv',
  'nucc',
  'nucc_taxonomy',
  'cms_ma_plan_directory',
  'cms_ma_plan_directory_page',
  'nppes_bulk_artifact'
]);

function createScopeTempTable({ sources = DEFAULT_SOURCES, normalizationVersion = 'v1' } = {}) {
  const sourceListRaw = Array.isArray(sources) && sources.length ? sources : DEFAULT_SOURCES;
  const sourceList = sourceListRaw.filter((s) => !PAYER_ER_EXCLUDED_SOURCES.has(String(s || '').trim()));
  const placeholders = sourceList.map(() => '?').join(', ');
  if (sourceList.length === 0) {
    throw new Error('No payer ER sources remain after exclusions');
  }
  db.db.exec(`DROP TABLE IF EXISTS tmp_payor_block_scope;`);
  db.db.exec(`
    CREATE TEMP TABLE tmp_payor_block_scope (
      normalized_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      normalized_name TEXT,
      soundex_key TEXT,
      prefix_key TEXT,
      raw_payer_id TEXT,
      raw_npi TEXT,
      raw_ein TEXT,
      org_signal INTEGER DEFAULT 0
    );
  `);
  db.db.prepare(`
    INSERT INTO tmp_payor_block_scope (normalized_id, source, normalized_name, soundex_key, prefix_key, raw_payer_id, raw_npi, raw_ein, org_signal)
    SELECT
      n.id AS normalized_id,
      n.source,
      n.normalized_name,
      n.soundex_key,
      n.prefix_key,
      s.raw_payer_id,
      s.raw_npi,
      s.raw_ein,
      CASE
        WHEN (s.raw_payer_id IS NOT NULL AND TRIM(s.raw_payer_id) <> '') THEN 1
        WHEN (s.raw_npi IS NOT NULL AND TRIM(s.raw_npi) <> '') THEN 1
        WHEN (s.raw_ein IS NOT NULL AND TRIM(s.raw_ein) <> '') THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' health ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' healthcare ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' care ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' insurance ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' medical ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' plan ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' blue ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' aetna ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' cigna ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' humana ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' molina ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' centene ') > 0 THEN 1
        WHEN instr(' ' || lower(COALESCE(n.normalized_name, '')) || ' ', ' anthem ') > 0 THEN 1
        ELSE 0
      END AS org_signal
    FROM payor_normalized_records n
    JOIN payor_source_records s ON s.id = n.source_record_id
    WHERE n.normalization_version = ?
      AND n.source IN (${placeholders})
      AND n.normalized_name IS NOT NULL
      AND TRIM(n.normalized_name) <> ''
  `).run(normalizationVersion, ...sourceList);
}

function buildBlockingCandidates({
  sources = DEFAULT_SOURCES,
  normalizationVersion = 'v1',
  batchId = `payor_block_${uuidv4()}`,
  maxBucketSize = 500,
  enforceCrossSourceOnly = true
} = {}) {
  createScopeTempTable({ sources, normalizationVersion });

  const eligibleRow = db.db.prepare(`SELECT COUNT(*) AS c FROM tmp_payor_block_scope`).get();
  const eligibleCount = Number(eligibleRow?.c || 0);
  const naivePairs = Math.max(0, (eligibleCount * (eligibleCount - 1)) / 2);

  const inserts = [
    {
      keyType: 'exact_payer_id',
      valueExpr: 'a.raw_payer_id',
      whereExpr: `a.raw_payer_id IS NOT NULL AND TRIM(a.raw_payer_id) <> '' AND a.raw_payer_id = b.raw_payer_id`,
      keyColumn: 'raw_payer_id',
      hard: 1,
      reason: 'exact_payer_id'
    },
    {
      keyType: 'exact_npi',
      valueExpr: 'a.raw_npi',
      whereExpr: `a.raw_npi IS NOT NULL AND TRIM(a.raw_npi) <> '' AND a.raw_npi = b.raw_npi`,
      keyColumn: 'raw_npi',
      hard: 1,
      reason: 'exact_npi'
    },
    {
      keyType: 'exact_ein',
      valueExpr: 'a.raw_ein',
      whereExpr: `a.raw_ein IS NOT NULL AND TRIM(a.raw_ein) <> '' AND a.raw_ein = b.raw_ein`,
      keyColumn: 'raw_ein',
      hard: 0,
      reason: null
    },
    {
      keyType: 'soundex_first_token',
      valueExpr: 'a.soundex_key',
      whereExpr: `a.soundex_key IS NOT NULL AND TRIM(a.soundex_key) <> '' AND a.soundex_key = b.soundex_key AND a.org_signal = 1 AND b.org_signal = 1`,
      keyColumn: 'soundex_key',
      hard: 0,
      reason: null
    },
    {
      keyType: 'normalized_prefix_key',
      valueExpr: 'a.prefix_key',
      whereExpr: `a.prefix_key IS NOT NULL AND TRIM(a.prefix_key) <> '' AND a.prefix_key = b.prefix_key AND a.org_signal = 1 AND b.org_signal = 1`,
      keyColumn: 'prefix_key',
      hard: 0,
      reason: null
    }
  ];

  const droppedKeysByBlockType = [];
  const byBlockKeyType = [];
  for (const cfg of inserts) {
    const totalDistinct = Number(
      db.db.prepare(`
        SELECT COUNT(*) AS c
        FROM (
          SELECT ${cfg.keyColumn}
          FROM tmp_payor_block_scope
          WHERE ${cfg.keyColumn} IS NOT NULL AND TRIM(${cfg.keyColumn}) <> ''
          GROUP BY ${cfg.keyColumn}
        ) t
      `).get()?.c || 0
    );
    const inRangeDistinct = Number(
      db.db.prepare(`
        SELECT COUNT(*) AS c
        FROM (
          SELECT ${cfg.keyColumn}
          FROM tmp_payor_block_scope
          WHERE ${cfg.keyColumn} IS NOT NULL AND TRIM(${cfg.keyColumn}) <> ''
          GROUP BY ${cfg.keyColumn}
          HAVING COUNT(*) BETWEEN 2 AND ?
        ) t
      `).get(maxBucketSize)?.c || 0
    );
    droppedKeysByBlockType.push({
      block_key_type: cfg.keyType,
      total_distinct_keys: totalDistinct,
      in_range_keys: inRangeDistinct,
      dropped_keys: Math.max(0, totalDistinct - inRangeDistinct),
      max_bucket_size: maxBucketSize
    });

    db.db.exec(`DROP TABLE IF EXISTS tmp_payor_block_keys;`);
    db.db.prepare(`
      CREATE TEMP TABLE tmp_payor_block_keys AS
      SELECT ${cfg.keyColumn} AS key_value
      FROM tmp_payor_block_scope
      WHERE ${cfg.keyColumn} IS NOT NULL AND TRIM(${cfg.keyColumn}) <> ''
      GROUP BY ${cfg.keyColumn}
      HAVING COUNT(*) BETWEEN 2 AND ?
    `).run(maxBucketSize);
    db.db.prepare(`
      INSERT OR IGNORE INTO payor_match_candidates (
        id, left_normalized_id, right_normalized_id, block_key_type, block_key_value, batch_id, hard_match, short_circuit_reason, created_at
      )
      SELECT
        'payor_cand_' || lower(hex(randomblob(16))) AS id,
        a.normalized_id AS left_normalized_id,
        b.normalized_id AS right_normalized_id,
        ? AS block_key_type,
        ${cfg.valueExpr} AS block_key_value,
        ? AS batch_id,
        ? AS hard_match,
        ? AS short_circuit_reason,
        datetime('now') AS created_at
      FROM tmp_payor_block_scope a
      JOIN tmp_payor_block_scope b
        ON a.normalized_id < b.normalized_id
      JOIN tmp_payor_block_keys k
        ON k.key_value = ${cfg.valueExpr}
      WHERE ${cfg.whereExpr}
        ${enforceCrossSourceOnly ? 'AND a.source <> b.source' : ''}
    `).run(cfg.keyType, batchId, cfg.hard, cfg.reason);
    const insertedByType = Number(
      db.db.prepare(`
        SELECT COUNT(*) AS c
        FROM payor_match_candidates
        WHERE batch_id = ? AND block_key_type = ?
      `).get(batchId, cfg.keyType)?.c || 0
    );
    byBlockKeyType.push({ block_key_type: cfg.keyType, candidate_count: insertedByType });
  }

  const candidateCount = Number(
    db.db.prepare(`SELECT COUNT(*) AS c FROM payor_match_candidates WHERE batch_id = ?`).get(batchId)?.c || 0
  );
  const hardCount = Number(
    db.db.prepare(`SELECT COUNT(*) AS c FROM payor_match_candidates WHERE batch_id = ? AND hard_match = 1`).get(batchId)?.c || 0
  );

  const bySourceCoverage = db.db.prepare(`
    WITH eligible AS (
      SELECT source, COUNT(*) AS eligible_records
      FROM tmp_payor_block_scope
      GROUP BY source
    ),
    matched_ids AS (
      SELECT left_normalized_id AS normalized_id FROM payor_match_candidates WHERE batch_id = ?
      UNION
      SELECT right_normalized_id AS normalized_id FROM payor_match_candidates WHERE batch_id = ?
    ),
    matched AS (
      SELECT s.source, COUNT(*) AS records_with_candidates
      FROM tmp_payor_block_scope s
      JOIN matched_ids m ON m.normalized_id = s.normalized_id
      GROUP BY s.source
    )
    SELECT
      e.source,
      e.eligible_records,
      COALESCE(m.records_with_candidates, 0) AS records_with_candidates
    FROM eligible e
    LEFT JOIN matched m ON m.source = e.source
    ORDER BY e.source
  `).all(batchId, batchId).map((r) => ({
    source: r.source,
    eligible_records: Number(r.eligible_records || 0),
    records_with_candidates: Number(r.records_with_candidates || 0),
    unmatched_residual: Math.max(0, Number(r.eligible_records || 0) - Number(r.records_with_candidates || 0)),
    coverage_pct: Number(r.eligible_records || 0)
      ? Number(((Number(r.records_with_candidates || 0) / Number(r.eligible_records || 0)) * 100).toFixed(2))
      : 0
  }));

  const sourcePairRows = db.db.prepare(`
    SELECT
      CASE WHEN a.source <= b.source
        THEN a.source || ' <-> ' || b.source
        ELSE b.source || ' <-> ' || a.source
      END AS source_pair,
      COUNT(*) AS candidate_count
    FROM payor_match_candidates c
    JOIN tmp_payor_block_scope a ON a.normalized_id = c.left_normalized_id
    JOIN tmp_payor_block_scope b ON b.normalized_id = c.right_normalized_id
    WHERE c.batch_id = ?
    GROUP BY source_pair
    ORDER BY candidate_count DESC
  `).all(batchId).map((r) => ({ source_pair: r.source_pair, candidate_count: Number(r.candidate_count || 0) }));

  const sameSourcePairCount = Number(
    db.db.prepare(`
      SELECT COUNT(*) AS c
      FROM payor_match_candidates c
      JOIN tmp_payor_block_scope a ON a.normalized_id = c.left_normalized_id
      JOIN tmp_payor_block_scope b ON b.normalized_id = c.right_normalized_id
      WHERE c.batch_id = ? AND a.source = b.source
    `).get(batchId)?.c || 0
  );
  const crossSourcePairCount = Math.max(0, candidateCount - sameSourcePairCount);
  const hardMatchRatePct = candidateCount ? Number(((hardCount / candidateCount) * 100).toFixed(2)) : 0;
  const crossSourceRatioPct = candidateCount ? Number(((crossSourcePairCount / candidateCount) * 100).toFixed(2)) : 0;

  return {
    batch_id: batchId,
    normalization_version: normalizationVersion,
    sources_in_scope: bySourceCoverage.map((r) => r.source),
    eligible_record_count: eligibleCount,
    naive_pair_count: naivePairs,
    candidate_pair_count: candidateCount,
    reduction_ratio_pct: naivePairs ? Number(((1 - (candidateCount / naivePairs)) * 100).toFixed(2)) : 0,
    hard_match_candidate_count: hardCount,
    hard_match_rate_pct: hardMatchRatePct,
    same_source_pair_count: sameSourcePairCount,
    cross_source_pair_count: crossSourcePairCount,
    cross_source_ratio_pct: crossSourceRatioPct,
    enforce_cross_source_only: Boolean(enforceCrossSourceOnly),
    by_block_key_type: byBlockKeyType,
    dropped_keys_by_block_type: droppedKeysByBlockType,
    by_source_coverage: bySourceCoverage,
    by_source_pair_candidates: sourcePairRows
  };
}

module.exports = {
  DEFAULT_SOURCES,
  buildBlockingCandidates
};

