'use strict';

const db = require('../database');

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function safeJsonParse(value) {
  try { return JSON.parse(value || '{}'); } catch (_) { return {}; }
}

function extractLocation(payload) {
  const addresses = Array.isArray(payload?.addresses) ? payload.addresses : [];
  const practice = addresses.find((a) => String(a?.address_purpose || '').toUpperCase() === 'LOCATION');
  const fallback = addresses[0] || null;
  const selected = practice || fallback;
  if (!selected) return null;
  const lat = Number(selected.latitude || selected.lat);
  const lon = Number(selected.longitude || selected.lon || selected.lng);
  return {
    city: selected.city || null,
    state: selected.state || null,
    postal_code: selected.postal_code || selected.zip || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null
  };
}

function listProviderSearchResults({
  taxonomyCode = null,
  latitude = null,
  longitude = null,
  radiusMiles = null,
  payorEntityId = null,
  page = 1,
  pageSize = 25
} = {}) {
  const offset = Math.max(0, (Math.max(1, Number(page) || 1) - 1) * (Math.max(1, Number(pageSize) || 25)));
  const limit = Math.min(100, Math.max(1, Number(pageSize) || 25));

  const taxonomyFilter = taxonomyCode ? String(taxonomyCode).trim() : null;
  const payorFilter = payorEntityId ? String(payorEntityId).trim() : null;
  const lat = Number(latitude);
  const lon = Number(longitude);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(Number(radiusMiles));
  const maxRadius = hasGeo ? Number(radiusMiles) : null;

  const rows = db.db.prepare(`
    SELECT
      e.id,
      e.canonical_npi,
      e.first_name,
      e.middle_name,
      e.last_name,
      e.organization_name,
      e.provider_type,
      e.updated_at,
      GROUP_CONCAT(DISTINCT ptl.nucc_code) AS taxonomy_codes,
      GROUP_CONCAT(DISTINCT ptl.taxonomy_group) AS taxonomy_groups,
      GROUP_CONCAT(DISTINCT psl.source) AS provenance_sources
    FROM provider_registry_entities e
    LEFT JOIN provider_taxonomy_links ptl ON ptl.provider_entity_id = e.id
    LEFT JOIN provider_registry_source_links psl ON psl.provider_entity_id = e.id
    LEFT JOIN provider_payer_networks ppn ON ppn.provider_entity_id = e.id
    WHERE e.status = 'active'
      AND (? IS NULL OR ptl.nucc_code = ?)
      AND (? IS NULL OR ppn.payor_entity_id = ?)
    GROUP BY e.id
    ORDER BY datetime(e.updated_at) DESC
    LIMIT ? OFFSET ?
  `).all(
    taxonomyFilter, taxonomyFilter,
    payorFilter, payorFilter,
    limit, offset
  );
  const countRow = db.db.prepare(`
    SELECT COUNT(DISTINCT e.id) AS total_count
    FROM provider_registry_entities e
    LEFT JOIN provider_taxonomy_links ptl ON ptl.provider_entity_id = e.id
    LEFT JOIN provider_payer_networks ppn ON ppn.provider_entity_id = e.id
    WHERE e.status = 'active'
      AND (? IS NULL OR ptl.nucc_code = ?)
      AND (? IS NULL OR ppn.payor_entity_id = ?)
  `).get(
    taxonomyFilter, taxonomyFilter,
    payorFilter, payorFilter
  );

  const sourcePayloadStmt = db.db.prepare(`
    SELECT r.payload_json, r.source, r.created_at
    FROM provider_registry_source_links l
    JOIN payor_source_records r ON r.id = l.source_record_id
    WHERE l.provider_entity_id = ?
    ORDER BY datetime(r.created_at) DESC
    LIMIT 5
  `);

  const ranked = [];
  for (const row of rows) {
    const payloadRows = sourcePayloadStmt.all(row.id);
    let locationEvidence = null;
    for (const pr of payloadRows) {
      const candidate = extractLocation(safeJsonParse(pr.payload_json));
      if (candidate) {
        locationEvidence = { ...candidate, source: pr.source };
        break;
      }
    }

    let distanceMiles = null;
    if (hasGeo && locationEvidence?.latitude != null && locationEvidence?.longitude != null) {
      distanceMiles = milesBetween(lat, lon, locationEvidence.latitude, locationEvidence.longitude);
      if (distanceMiles > maxRadius) continue;
    }

    const taxonomyCodes = (row.taxonomy_codes || '').split(',').filter(Boolean);
    const provenanceSources = (row.provenance_sources || '').split(',').filter(Boolean);
    const taxonomyScore = taxonomyFilter ? (taxonomyCodes.includes(taxonomyFilter) ? 1 : 0) : Math.min(1, taxonomyCodes.length / 3);
    const provenanceScore = Math.min(1, provenanceSources.length / 3);
    const distanceScore = distanceMiles == null || !Number.isFinite(distanceMiles)
      ? 0.5
      : Math.max(0, 1 - (distanceMiles / Math.max(1, maxRadius || 25)));
    const rankScore = Number((0.5 * taxonomyScore + 0.2 * provenanceScore + 0.3 * distanceScore).toFixed(4));

    ranked.push({
      provider_entity_id: row.id,
      canonical_npi: row.canonical_npi,
      provider_name: row.organization_name || [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') || null,
      provider_type: row.provider_type,
      taxonomy_codes: taxonomyCodes,
      taxonomy_evidence: (row.taxonomy_groups || '').split(',').filter(Boolean),
      source_provenance: provenanceSources,
      location_evidence: locationEvidence,
      distance_miles: distanceMiles == null ? null : Number(distanceMiles.toFixed(2)),
      rank_score: rankScore
    });
  }

  ranked.sort((a, b) => b.rank_score - a.rank_score);
  return {
    page: Math.max(1, Number(page) || 1),
    page_size: limit,
    total_count: Number(countRow?.total_count || 0),
    count: ranked.length,
    providers: ranked
  };
}

module.exports = {
  listProviderSearchResults
};

