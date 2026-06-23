'use strict';

/**
 * Normalizes SpecialistResolverService provider Map entries into UI-safe ProviderCard DTOs.
 * Phone is only marked trusted when present from directory (provider_profiles).
 */

function specialtyLabel(attrs) {
  const s = attrs?.specialty;
  if (Array.isArray(s) && s.length) return String(s[0]);
  if (typeof s === 'string') return s;
  return '';
}

/**
 * @param {Map<string, object>} providerMap
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {string|null} [opts.booking_url_base] — optional prefix for booking deep links
 */
function resolverMapToProviderCards(providerMap, opts = {}) {
  const limit = Math.min(10, Math.max(1, Number(opts.limit) || 3));
  if (!providerMap || typeof providerMap.entries !== 'function') return [];

  const out = [];
  for (const [provider_id, attrs] of providerMap.entries()) {
    if (out.length >= limit) break;
    const phone = attrs?.phone != null ? String(attrs.phone).trim() : '';
    out.push({
      provider_id: String(provider_id),
      display_name: String(attrs?.display_name || 'Clinician').trim() || 'Clinician',
      specialty: specialtyLabel(attrs),
      distance_km: attrs?.distance_km != null ? Number(attrs.distance_km) : null,
      booking_url: attrs?.booking_url || (opts.booking_url_base ? `${opts.booking_url_base}?provider_id=${encodeURIComponent(provider_id)}` : null),
      phone: phone || null,
      phone_trust: phone ? 'verified_directory' : 'none',
      match_mode: attrs?.match_mode || null,
      match_reason: attrs?.match_reason || null
    });
  }
  return out;
}

module.exports = { resolverMapToProviderCards, specialtyLabel };
