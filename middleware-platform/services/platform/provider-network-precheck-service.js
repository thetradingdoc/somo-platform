'use strict';

const db = require('../../database');

function firstNonEmpty(...values) {
  for (const v of values) {
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/**
 * Runtime provider↔payor network status for eligibility/claim paths.
 * When `provider_payer_networks` has no rows at all, returns reason `no_network_data`
 * (distinct from `network_link_not_found` when directory data exists but not this pair).
 */
function resolveProviderPayorNetworkPrecheck({ args = {}, resolverOutcome = null } = {}) {
  const providerNpi = firstNonEmpty(
    args.rendering_provider_npi,
    args.provider_npi,
    args.npi,
    args.rendering_npi
  );
  const routedPayerId = firstNonEmpty(
    resolverOutcome?.routing?.payer_id,
    args.payer_id
  );
  let payorEntityId = firstNonEmpty(resolverOutcome?.canonical_entity?.id);
  if (!payorEntityId && routedPayerId) {
    const payor = db.db.prepare(`
      SELECT id
      FROM payor_canonical_entities
      WHERE status = 'active'
        AND canonical_payer_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(routedPayerId);
    payorEntityId = payor?.id || null;
  }
  if (!providerNpi || !payorEntityId) {
    return {
      decision: 'unknown',
      reason: 'missing_provider_or_payor_context',
      trace: {
        provider_npi: providerNpi,
        payor_entity_id: payorEntityId,
        routed_payer_id: routedPayerId
      }
    };
  }
  const provider = db.db.prepare(`
    SELECT id
    FROM provider_registry_entities
    WHERE canonical_npi = ?
      AND status = 'active'
    LIMIT 1
  `).get(providerNpi);
  if (!provider) {
    return {
      decision: 'unknown',
      reason: 'provider_not_found',
      trace: { provider_npi: providerNpi, payor_entity_id: payorEntityId, routed_payer_id: routedPayerId }
    };
  }

  const networkRowCount = db.db.prepare(`
    SELECT COUNT(*) AS c FROM provider_payer_networks
  `).get();
  if (!Number(networkRowCount?.c)) {
    return {
      decision: 'unknown',
      reason: 'no_network_data',
      trace: {
        provider_npi: providerNpi,
        provider_entity_id: provider.id,
        payor_entity_id: payorEntityId,
        routed_payer_id: routedPayerId
      }
    };
  }

  const link = db.db.prepare(`
    SELECT id, network_status, confidence, source, effective_start_date, effective_end_date, provenance_json
    FROM provider_payer_networks
    WHERE provider_entity_id = ?
      AND payor_entity_id = ?
    ORDER BY
      COALESCE(confidence, 0) DESC,
      COALESCE(date(effective_start_date), date('1900-01-01')) DESC,
      updated_at DESC
    LIMIT 1
  `).get(provider.id, payorEntityId);
  if (!link) {
    return {
      decision: 'unknown',
      reason: 'network_link_not_found',
      trace: { provider_npi: providerNpi, payor_entity_id: payorEntityId, routed_payer_id: routedPayerId }
    };
  }
  const decision = link.network_status === 'in_network'
    ? 'in_network'
    : (link.network_status === 'out_of_network' ? 'out_of_network' : 'unknown');
  return {
    decision,
    reason: 'network_link_match',
    trace: {
      provider_npi: providerNpi,
      provider_entity_id: provider.id,
      payor_entity_id: payorEntityId,
      routed_payer_id: routedPayerId,
      network_link_id: link.id,
      network_status: link.network_status,
      confidence: link.confidence,
      source: link.source,
      effective_start_date: link.effective_start_date || null,
      effective_end_date: link.effective_end_date || null,
      provenance_json: link.provenance_json || null
    }
  };
}

module.exports = {
  resolveProviderPayorNetworkPrecheck
};
