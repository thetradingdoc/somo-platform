'use strict';

const db = require('../database');
const { normalizeAlias } = require('./payor-canonicalization-service');

function firstNonEmpty(...values) {
  for (const v of values) {
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function getEntityByStructuredIds({ payerId = null, npi = null, ein = null }) {
  const pid = payerId ? String(payerId).trim() : null;
  const n = npi ? String(npi).trim() : null;
  const e = ein ? String(ein).trim() : null;
  if (!pid && !n && !e) return null;
  return db.db.prepare(`
    SELECT *
    FROM payor_canonical_entities
    WHERE status = 'active'
      AND (
        (? IS NOT NULL AND canonical_payer_id = ?)
        OR (? IS NOT NULL AND canonical_npi = ?)
        OR (? IS NOT NULL AND canonical_ein = ?)
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(pid, pid, n, n, e, e);
}

function getEntityByAlias(payerText) {
  const normalized = normalizeAlias(payerText || '');
  if (!normalized) return null;
  return db.db.prepare(`
    SELECT e.*
    FROM payor_entity_aliases a
    JOIN payor_canonical_entities e ON e.id = a.entity_id
    WHERE a.alias_normalized = ?
      AND e.status = 'active'
    ORDER BY a.confidence DESC, e.updated_at DESC
    LIMIT 1
  `).get(normalized);
}

function resolvePayor({ payerText = null, payerId = null, npi = null, ein = null, stateHint = null } = {}) {
  const routingFallback = {
    payer_id: firstNonEmpty(payerId),
    npi: firstNonEmpty(npi),
    ein: firstNonEmpty(ein),
    state_scope: firstNonEmpty(stateHint)
  };
  try {
    const byIds = getEntityByStructuredIds({ payerId, npi, ein });
    const byAlias = byIds ? null : getEntityByAlias(payerText);
    const entity = byIds || byAlias;
    if (!entity) {
      return {
        resolved: false,
        resolution_source: 'none',
        canonical_entity: null,
        routing: routingFallback
      };
    }

    return {
      resolved: true,
      resolution_source: byIds ? 'canonical_structured_id' : 'canonical_alias_exact',
      canonical_entity: {
        id: entity.id,
        canonical_name: entity.canonical_name,
        canonical_payer_id: entity.canonical_payer_id || null,
        canonical_npi: entity.canonical_npi || null,
        canonical_ein: entity.canonical_ein || null,
        state_scope: entity.state_scope || null,
        status: entity.status
      },
      routing: {
        payer_id: firstNonEmpty(entity.canonical_payer_id, payerId),
        npi: firstNonEmpty(entity.canonical_npi, npi),
        ein: firstNonEmpty(entity.canonical_ein, ein),
        state_scope: firstNonEmpty(entity.state_scope, stateHint)
      }
    };
  } catch (_) {
    return {
      resolved: false,
      resolution_source: 'none',
      canonical_entity: null,
      routing: routingFallback
    };
  }
}

module.exports = {
  resolvePayor
};

