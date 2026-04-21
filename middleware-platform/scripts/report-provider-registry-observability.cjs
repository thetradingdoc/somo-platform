#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function main() {
  const counts = db.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM provider_registry_entities WHERE status = 'active') AS active_provider_entities,
      (SELECT COUNT(*) FROM provider_registry_source_links) AS source_link_count,
      (SELECT COUNT(*) FROM provider_taxonomy_links) AS taxonomy_link_count,
      (SELECT COUNT(*) FROM provider_payer_networks) AS provider_payor_network_count,
      (SELECT COUNT(*) FROM provider_registry_aliases) AS alias_count
  `).get();

  const dedup = db.db.prepare(`
    SELECT
      COUNT(*) AS distinct_npi_count,
      SUM(CASE WHEN source_count > 1 THEN 1 ELSE 0 END) AS merged_provider_count
    FROM (
      SELECT e.id, COUNT(DISTINCT l.source || ':' || l.source_record_id) AS source_count
      FROM provider_registry_entities e
      LEFT JOIN provider_registry_source_links l ON l.provider_entity_id = e.id
      WHERE e.status = 'active'
      GROUP BY e.id
    )
  `).get();

  const coverage = db.db.prepare(`
    SELECT
      CASE WHEN p.total = 0 THEN 0 ELSE ROUND(1.0 * t.providers_with_taxonomy / p.total, 4) END AS taxonomy_coverage,
      CASE WHEN p.total = 0 THEN 0 ELSE ROUND(1.0 * n.providers_with_network / p.total, 4) END AS network_linkage_coverage
    FROM
      (SELECT COUNT(*) AS total FROM provider_registry_entities WHERE status = 'active') p,
      (SELECT COUNT(DISTINCT provider_entity_id) AS providers_with_taxonomy FROM provider_taxonomy_links) t,
      (SELECT COUNT(DISTINCT provider_entity_id) AS providers_with_network FROM provider_payer_networks) n
  `).get();

  const staleness = db.db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(updated_at) > 30 THEN 1 ELSE 0 END), 0) AS stale_over_30d,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(updated_at) > 90 THEN 1 ELSE 0 END), 0) AS stale_over_90d
    FROM provider_registry_entities
    WHERE status = 'active'
  `).get();

  console.log(JSON.stringify({
    event: 'provider_registry_observability_report',
    counts,
    dedup_stats: {
      distinct_npi_count: Number(dedup?.distinct_npi_count || 0),
      merged_provider_count: Number(dedup?.merged_provider_count || 0)
    },
    coverage,
    staleness
  }, null, 2));
}

main();

