'use strict';

/**
 * Computes provider↔payor network drift / quality signals (used by report script + tests).
 * @param {import('better-sqlite3').Database} sqlite
 */
function computeProviderNetworkDriftQuality(sqlite) {
  const quality = sqlite.prepare(`
    SELECT
      COUNT(*) AS total_links,
      SUM(CASE WHEN confidence IS NULL OR confidence < 0.6 THEN 1 ELSE 0 END) AS low_confidence_links,
      SUM(CASE WHEN network_status NOT IN ('in_network','out_of_network','unknown') THEN 1 ELSE 0 END) AS invalid_status_links,
      SUM(CASE WHEN effective_end_date IS NOT NULL AND effective_start_date IS NOT NULL AND date(effective_end_date) < date(effective_start_date) THEN 1 ELSE 0 END) AS invalid_date_range_links
    FROM provider_payer_networks
  `).get();

  const byStatus = sqlite.prepare(`
    SELECT network_status, COUNT(*) AS count
    FROM provider_payer_networks
    GROUP BY network_status
    ORDER BY count DESC
  `).all();

  const recentWindow = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN datetime(updated_at) >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS updated_last_7d,
      SUM(CASE WHEN datetime(updated_at) < datetime('now', '-90 days') THEN 1 ELSE 0 END) AS stale_over_90d
    FROM provider_payer_networks
  `).get();

  const potentialDrift = sqlite.prepare(`
    SELECT provider_entity_id, payor_entity_id, COUNT(DISTINCT network_status) AS status_variants
    FROM provider_payer_networks
    GROUP BY provider_entity_id, payor_entity_id
    HAVING COUNT(DISTINCT network_status) > 1
    ORDER BY status_variants DESC
    LIMIT 100
  `).all();

  const lowConfidenceRows = sqlite.prepare(`
    SELECT e.canonical_npi AS provider_npi, c.canonical_payer_id AS payer_id, n.confidence
    FROM provider_payer_networks n
    JOIN provider_registry_entities e ON e.id = n.provider_entity_id
    JOIN payor_canonical_entities c ON c.id = n.payor_entity_id
    WHERE n.confidence IS NULL OR n.confidence < 0.6
    ORDER BY COALESCE(n.confidence, 0) ASC, e.canonical_npi ASC
  `).all();

  const invalidStatusRows = sqlite.prepare(`
    SELECT e.canonical_npi AS provider_npi, c.canonical_payer_id AS payer_id, n.network_status
    FROM provider_payer_networks n
    JOIN provider_registry_entities e ON e.id = n.provider_entity_id
    JOIN payor_canonical_entities c ON c.id = n.payor_entity_id
    WHERE n.network_status NOT IN ('in_network','out_of_network','unknown')
    ORDER BY e.canonical_npi ASC
  `).all();

  const invalidDateRows = sqlite.prepare(`
    SELECT e.canonical_npi AS provider_npi, c.canonical_payer_id AS payer_id, n.effective_start_date, n.effective_end_date
    FROM provider_payer_networks n
    JOIN provider_registry_entities e ON e.id = n.provider_entity_id
    JOIN payor_canonical_entities c ON c.id = n.payor_entity_id
    WHERE n.effective_end_date IS NOT NULL
      AND n.effective_start_date IS NOT NULL
      AND date(n.effective_end_date) < date(n.effective_start_date)
    ORDER BY e.canonical_npi ASC
  `).all();

  const staleRows = sqlite.prepare(`
    SELECT e.canonical_npi AS provider_npi, c.canonical_payer_id AS payer_id, n.effective_start_date, n.updated_at
    FROM provider_payer_networks n
    JOIN provider_registry_entities e ON e.id = n.provider_entity_id
    JOIN payor_canonical_entities c ON c.id = n.payor_entity_id
    WHERE n.effective_start_date IS NOT NULL
      AND date(n.effective_start_date) < date('now', '-18 months')
      AND datetime(n.updated_at) < datetime('now', '-180 days')
    ORDER BY e.canonical_npi ASC
  `).all();

  const driftRows = sqlite.prepare(`
    SELECT
      e.canonical_npi AS provider_npi,
      c.canonical_payer_id AS payer_id,
      COUNT(DISTINCT n.network_status) AS status_variants
    FROM provider_payer_networks n
    JOIN provider_registry_entities e ON e.id = n.provider_entity_id
    JOIN payor_canonical_entities c ON c.id = n.payor_entity_id
    GROUP BY n.provider_entity_id, n.payor_entity_id
    HAVING COUNT(DISTINCT n.network_status) > 1
    ORDER BY status_variants DESC, e.canonical_npi ASC
  `).all();

  const totalLinks = Number(quality?.total_links || 0);
  const lowConfidenceRate = totalLinks > 0
    ? Number((Number(quality.low_confidence_links || 0) / totalLinks).toFixed(4))
    : 0;
  const pass = lowConfidenceRows.length === 0
    && invalidStatusRows.length === 0
    && invalidDateRows.length === 0
    && staleRows.length === 0
    && driftRows.length === 0;

  return {
    event: 'provider_network_drift_quality_report',
    pass,
    totals: {
      total_links: totalLinks,
      low_confidence_links: Number(quality?.low_confidence_links || 0),
      invalid_status_links: Number(quality?.invalid_status_links || 0),
      invalid_date_range_links: Number(quality?.invalid_date_range_links || 0),
      low_confidence_rate: lowConfidenceRate
    },
    recency: {
      updated_last_7d: Number(recentWindow?.updated_last_7d || 0),
      stale_over_90d: Number(recentWindow?.stale_over_90d || 0)
    },
    low_confidence_links: lowConfidenceRows,
    invalid_statuses: invalidStatusRows,
    invalid_date_ranges: invalidDateRows,
    stale_links: staleRows,
    status_drift_pairs: driftRows,
    by_status: byStatus,
    potential_status_drift_pairs: potentialDrift
  };
}

module.exports = {
  computeProviderNetworkDriftQuality
};
