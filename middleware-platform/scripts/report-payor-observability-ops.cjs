#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function truthyEnv(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase().trim());
}

/**
 * Optional CMS-authoritative baseline gates (mirrors docs/Payor/PRODUCTION_READINESS_BASELINE.md).
 * Enable when PAYOR_OPS_BASELINE_MODE=cms_only or PAYOR_READINESS_VENDOR_MODE=cms_only or PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1.
 * Set PAYOR_OPS_STRICT_BASELINE=1 to AND these gates into report `pass` (and use doc floor for raw row count).
 * PAYOR_OPS_CMS_MIN_NPPES_BULK_RAW defaults to 0 (informational only when strict is off).
 */
function buildCmsAuthoritativeBaseline(sqlite) {
  const enabled =
    String(process.env.PAYOR_OPS_BASELINE_MODE || '').trim().toLowerCase() === 'cms_only' ||
    String(process.env.PAYOR_READINESS_VENDOR_MODE || '').trim().toLowerCase() === 'cms_only' ||
    truthyEnv('PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY');
  if (!enabled) return null;

  const minRawEnv = process.env.PAYOR_OPS_CMS_MIN_NPPES_BULK_RAW;
  const minRaw = minRawEnv === undefined || String(minRawEnv).trim() === ''
    ? 0
    : Math.max(0, Number(minRawEnv) || 0);
  const strict = truthyEnv('PAYOR_OPS_STRICT_BASELINE');
  const DOC_FLOOR_RAW = 1000;

  const rawNppes = Number(sqlite.prepare(`SELECT COUNT(*) AS c FROM payor_source_records WHERE source = 'nppes_bulk'`).get()?.c || 0);
  const normNppes = Number(sqlite.prepare(`SELECT COUNT(*) AS c FROM payor_normalized_records WHERE source = 'nppes_bulk'`).get()?.c || 0);

  const gates = [
    {
      id: 'nppes_bulk_raw_rows_vs_env_min',
      pass: rawNppes >= minRaw,
      detail: `nppes_bulk payor_source_records=${rawNppes}, PAYOR_OPS_CMS_MIN_NPPES_BULK_RAW=${minRawEnv === undefined || String(minRawEnv).trim() === '' ? '0 (default)' : minRaw}`
    },
    {
      id: 'nppes_bulk_normalized_rows_gt_0',
      pass: normNppes > 0,
      detail: `nppes_bulk payor_normalized_records=${normNppes}`
    }
  ];
  if (strict) {
    gates.push({
      id: 'nppes_bulk_raw_rows_ge_doc_floor_1000',
      pass: rawNppes >= DOC_FLOOR_RAW,
      detail: `nppes_bulk raw=${rawNppes}, doc_floor=${DOC_FLOOR_RAW} (CMS track eligible_record_count proxy)`
    });
  }

  return {
    enabled: true,
    strict,
    gates,
    pass: gates.every((g) => g.pass),
    doc_anchor: 'docs/Payor/PRODUCTION_READINESS_BASELINE.md#cms-authoritative-track-no-office-ally--inovalon'
  };
}

/** Latest `payor_ingest_routing_summary` audit rows for routed_* / skipped_null_identity sanity (§14.B). */
function buildIngestRoutingSanity(sqlite) {
  const rows = sqlite.prepare(`
    SELECT id, payload_json, created_at
    FROM payor_audit_log
    WHERE event_type = 'payor_ingest_routing_summary'
    ORDER BY datetime(created_at) DESC
    LIMIT 50
  `).all();

  const parsed = [];
  const latestBySource = new Map();
  for (const r of rows) {
    let p = {};
    try {
      p = JSON.parse(r.payload_json || '{}');
    } catch (_) {
      p = { parse_error: true };
    }
    const row = { audit_id: r.id, created_at: r.created_at, ...p };
    parsed.push(row);
    const src = p.source || 'unknown';
    if (!latestBySource.has(src)) latestBySource.set(src, p);
  }

  const notes = [];
  const nppesBulk = latestBySource.get('nppes_bulk');
  if (
    nppesBulk &&
    Number(nppesBulk.read_rows || 0) >= 50000 &&
    Number(nppesBulk.routed_provider_rows || 0) === 0
  ) {
    notes.push(
      'nppes_bulk: read_rows>=50k but routed_provider_rows=0 — check CSV / entity type split (Type 1 should increment routed_provider_rows)'
    );
  }
  const inov = latestBySource.get('inovalon');
  if (
    inov &&
    Number(inov.inserted || 0) > 50 &&
    Number(inov.routed_provider_rows || 0) === 0 &&
    Number(inov.routed_payor_rows || 0) === 0
  ) {
    notes.push('inovalon: inserts>0 but both routing counters zero — verify mapRow / entity_type');
  }

  return {
    recent_events: parsed.slice(0, 25),
    latest_by_source: Object.fromEntries(latestBySource),
    sanity_notes: notes,
    pass_soft: notes.length === 0,
    event_count: rows.length
  };
}

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const policyVersion = getArg('policy-version', null);

const ingestCountsBySource = db.db.prepare(`
  SELECT source, COUNT(*) AS batch_count, SUM(COALESCE(record_count, 0)) AS record_count
  FROM payor_ingest_batches
  GROUP BY source
  ORDER BY record_count DESC
`).all();

const normalizationCoverage = db.db.prepare(`
  SELECT
    COUNT(*) AS source_records,
    (SELECT COUNT(*) FROM payor_normalized_records) AS normalized_records,
    ROUND(
      CASE WHEN COUNT(*) = 0 THEN 0
      ELSE (SELECT COUNT(*) FROM payor_normalized_records) * 1.0 / COUNT(*)
      END, 6
    ) AS coverage_ratio
  FROM payor_source_records
`).get();

const blockingReduction = db.db.prepare(`
  SELECT
    COALESCE(MAX(naive_pair_count), 0) AS naive_pair_count,
    COALESCE(MAX(candidate_pair_count), 0) AS candidate_pair_count,
    COALESCE(MAX(reduction_ratio_pct), 0) AS reduction_ratio_pct
  FROM (
    SELECT
      CAST(json_extract(payload_json, '$.naive_pair_count') AS REAL) AS naive_pair_count,
      CAST(json_extract(payload_json, '$.candidate_pair_count') AS REAL) AS candidate_pair_count,
      CAST(json_extract(payload_json, '$.reduction_ratio_pct') AS REAL) AS reduction_ratio_pct
    FROM payor_audit_log
    WHERE event_type = 'blocking_report'
  )
`).get();

const decisionWhere = policyVersion ? 'WHERE policy_version = ?' : '';
const decisionArgs = policyVersion ? [policyVersion] : [];
const decisionStats = db.db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN decision = 'auto_merge' THEN 1 ELSE 0 END) AS auto_merge_count
  FROM payor_resolution_decisions
  ${decisionWhere}
`).get(...decisionArgs);

const reviewQueueVolumeAge = db.db.prepare(`
  SELECT
    COUNT(*) AS pending_count,
    ROUND(COALESCE(MAX((julianday('now') - julianday(created_at)) * 24), 0), 2) AS oldest_pending_hours
  FROM payor_review_queue
  WHERE status = 'pending'
`).get();

const falseMergeCorrection = db.db.prepare(`
  SELECT
    COUNT(*) AS reviewed_merge_like,
    SUM(CASE WHEN reviewer_action = 'separate' THEN 1 ELSE 0 END) AS corrected_false_merge,
    ROUND(
      CASE WHEN COUNT(*) = 0 THEN 0
      ELSE SUM(CASE WHEN reviewer_action = 'separate' THEN 1 ELSE 0 END) * 1.0 / COUNT(*)
      END, 6
    ) AS correction_rate
  FROM payor_review_feedback_outcomes
  WHERE model_decision IN ('auto_merge', 'merge_review_flag')
    ${policyVersion ? 'AND policy_version = ?' : ''}
`).get(...(policyVersion ? [policyVersion] : []));

const auditLogging = db.db.prepare(`
  SELECT
    SUM(CASE WHEN event_type = 'resolution_decision_upserted' THEN 1 ELSE 0 END) AS decision_trace_events,
    SUM(CASE WHEN event_type = 'reviewer_action_submitted' THEN 1 ELSE 0 END) AS reviewer_action_events,
    SUM(CASE WHEN event_type = 'payor_ingest_routing_summary' THEN 1 ELSE 0 END) AS ingest_routing_summary_events
  FROM payor_audit_log
`).get();

const uniquenessChecks = {
  source_record_duplicates: db.db.prepare(`
    SELECT COUNT(*) AS c
    FROM (
      SELECT batch_id, source, source_record_id, COUNT(*) AS n
      FROM payor_source_records
      GROUP BY batch_id, source, source_record_id
      HAVING n > 1
    )
  `).get().c,
  candidate_duplicates: db.db.prepare(`
    SELECT COUNT(*) AS c
    FROM (
      SELECT left_normalized_id, right_normalized_id, block_key_type, block_key_value, batch_id, COUNT(*) AS n
      FROM payor_match_candidates
      GROUP BY left_normalized_id, right_normalized_id, block_key_type, block_key_value, batch_id
      HAVING n > 1
    )
  `).get().c
};

const orphanLinkChecks = db.db.prepare(`
  SELECT COUNT(*) AS orphan_count
  FROM payor_entity_links l
  LEFT JOIN payor_canonical_entities e ON e.id = l.entity_id
  LEFT JOIN payor_source_records s ON s.id = l.source_record_id
  LEFT JOIN payor_resolution_decisions d ON d.id = l.decision_id
  WHERE e.id IS NULL OR s.id IS NULL OR (l.decision_id IS NOT NULL AND d.id IS NULL)
`).get();

const aliasCollision = db.db.prepare(`
  SELECT COUNT(*) AS collision_count
  FROM (
    SELECT alias_normalized, COUNT(DISTINCT entity_id) AS entity_count
    FROM payor_entity_aliases
    GROUP BY alias_normalized
    HAVING entity_count > 1
  )
`).get();

const baselineCms = buildCmsAuthoritativeBaseline(db.db);
const ingestRouting = buildIngestRoutingSanity(db.db);
const dataQualityPass = (
  Number(uniquenessChecks.source_record_duplicates || 0) === 0 &&
  Number(uniquenessChecks.candidate_duplicates || 0) === 0 &&
  Number(orphanLinkChecks?.orphan_count || 0) === 0
);
const routingStrict = truthyEnv('PAYOR_OPS_ROUTING_STRICT');
const pass = dataQualityPass &&
  (!baselineCms || !baselineCms.strict || baselineCms.pass) &&
  (!routingStrict || ingestRouting.pass_soft);

const report = {
  generated_at: new Date().toISOString(),
  event: 'payor_observability_quality_ops_report',
  policy_version: policyVersion,
  sqlite_path: db.sqliteDatabasePath || null,
  db_path_env: process.env.DB_PATH || null,
  metrics: {
    ingest_counts_by_source: ingestCountsBySource,
    normalization_coverage: normalizationCoverage,
    block_reduction_ratio: blockingReduction,
    auto_merge_rate: {
      total_decisions: Number(decisionStats?.total || 0),
      auto_merge_count: Number(decisionStats?.auto_merge_count || 0),
      auto_merge_rate: Number(
        (Number(decisionStats?.total || 0) === 0
          ? 0
          : Number(decisionStats.auto_merge_count || 0) / Number(decisionStats.total || 1)
        ).toFixed(6)
      )
    },
    review_queue_volume_age: {
      pending_count: Number(reviewQueueVolumeAge?.pending_count || 0),
      oldest_pending_hours: Number(reviewQueueVolumeAge?.oldest_pending_hours || 0)
    },
    false_merge_correction_rate: {
      reviewed_merge_like: Number(falseMergeCorrection?.reviewed_merge_like || 0),
      corrected_false_merge: Number(falseMergeCorrection?.corrected_false_merge || 0),
      correction_rate: Number(falseMergeCorrection?.correction_rate || 0)
    },
    ingest_routing: ingestRouting
  },
  audit_logging: {
    decision_trace_events: Number(auditLogging?.decision_trace_events || 0),
    reviewer_action_events: Number(auditLogging?.reviewer_action_events || 0),
    ingest_routing_summary_events: Number(auditLogging?.ingest_routing_summary_events || 0)
  },
  data_quality_checks: {
    uniqueness_constraints_validated: uniquenessChecks,
    orphan_link_checks: {
      orphan_count: Number(orphanLinkChecks?.orphan_count || 0)
    },
    alias_collision_checks: {
      collision_count: Number(aliasCollision?.collision_count || 0)
    }
  },
  baseline_cms_authoritative: baselineCms,
  pass
};

const outPath = path.join(process.cwd(), 'test-results/readiness-artifacts/payor-observability-quality-ops-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Payor observability+ops report written: ${outPath}`);
console.log(JSON.stringify(report, null, 2));

