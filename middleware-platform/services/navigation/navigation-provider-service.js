'use strict';

const SpecialistResolverService = require('../specialist-resolver-service');
const { resolveProviderPayorNetworkPrecheck } = require('../provider-network-precheck-service');
const { getCopayHintForSpecialty } = require('./navigation-benefits-service');
const { resolveNavClinicId } = require('../../scripts/lib/navigation-demo-config.cjs');
const db = require('../../database');

function specialtyKeyForSpecialty(specialty) {
  const map = {
    Dental: 'dental',
    Orthodontics: 'orthodontics',
    Optometry: 'vision',
    Psychiatry: 'mental_health',
    PrimaryCare: 'primary_care'
  };
  return map[specialty] || null;
}

function profileToCard(profile, { inNetwork = null } = {}) {
  let meta = {};
  try {
    meta = profile.bio ? JSON.parse(profile.bio) : {};
  } catch (_) {}
  let specialty = profile.specialty;
  try {
    const parsed = JSON.parse(profile.specialty || '[]');
    specialty = Array.isArray(parsed) ? parsed[0] : profile.specialty;
  } catch (_) {}
  return {
    provider_id: profile.id,
    display_name: profile.display_name || profile.name || profile.email,
    specialty,
    email: profile.email || null,
    booking_available: false,
    in_network: inNetwork,
    city: meta.city || 'New York',
    state: meta.state || 'NY',
    zip: meta.zip || null,
    phone: profile.phone || meta.phone || null,
    hours: meta.hours || null,
    match_reason: meta.match_reason || null
  };
}

function rankProviders(providers, zip) {
  if (!zip) return providers;
  const target = String(zip).slice(0, 3);
  return [...providers].sort((a, b) => {
    const aZip = String(a.zip || '').slice(0, 3);
    const bZip = String(b.zip || '').slice(0, 3);
    const aMatch = aZip === target ? 1 : 0;
    const bMatch = bZip === target ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    if (a.in_network && !b.in_network) return -1;
    if (!a.in_network && b.in_network) return 1;
    return 0;
  });
}

async function findCareNearMe({
  clinic_id,
  specialty,
  zip,
  payor_entity_id,
  payer_id,
  in_network_only = false
} = {}) {
  const clinicId = clinic_id || resolveNavClinicId(db);
  if (!clinicId) {
    return { success: false, error: 'clinic_not_configured' };
  }
  if (!specialty) {
    return { success: false, error: 'specialty_required' };
  }

  const resolved = await SpecialistResolverService.resolve({
    clinicId,
    specialty,
    language: 'en',
    state: 'NY',
    lane: 'sync',
    urgency: 'routine'
  });

  const providers = [];
  for (const [, attrs] of resolved.providers) {
    const row = db.db
      .prepare('SELECT * FROM provider_profiles WHERE id = ? LIMIT 1')
      .get(attrs.id);
    if (!row) continue;

    let inNetwork = null;
    if (payor_entity_id) {
      const npi = row.npi || attrs.npi || null;
      const pre = resolveProviderPayorNetworkPrecheck({
        args: { provider_npi: npi, payer_id },
        resolverOutcome: { canonical_entity: { id: payor_entity_id }, routing: { payer_id } }
      });
      inNetwork = pre.decision === 'in_network' || pre.decision === 'likely_in_network';
      if (in_network_only && pre.decision !== 'in_network' && pre.decision !== 'likely_in_network') {
        continue;
      }
    }

    providers.push(
      profileToCard(
        { ...row, specialty: attrs.specialty || row.specialty, display_name: attrs.display_name },
        { inNetwork }
      )
    );
  }

  const ranked = rankProviders(providers, zip);

  if (!ranked.length) {
    return {
      success: true,
      providers: [],
      match_mode: resolved.matchMode,
      zip: zip || null,
      specialty,
      message: in_network_only
        ? 'No in-network providers matched for that specialty near you in the demo network.'
        : 'No providers matched for that specialty right now.'
    };
  }

  return {
    success: true,
    providers: ranked,
    match_mode: resolved.matchMode,
    zip: zip || null,
    specialty,
    specialty_key: specialtyKeyForSpecialty(specialty)
  };
}

function buildRecommendationNarrative({ careLabel, specialty, planName, provider }) {
  const copay = getCopayHintForSpecialty(specialty);
  const typeLine = careLabel
    ? `For ${careLabel}, ${provider.match_reason || 'a specialist'} is the right type of care.`
    : `For ${specialty}, ${provider.match_reason || 'this specialist'} is a good fit.`;
  const planLine = planName
    ? `On ${planName}${copay ? `, ${copay}` : ''}.`
    : copay
      ? `${copay}.`
      : '';
  const providerLine = `${provider.display_name} is${provider.in_network ? ' in-network' : ''} near you.`;
  return [typeLine, planLine, providerLine].filter(Boolean).join(' ');
}

async function recommendCare({
  clinic_id,
  specialty,
  care_label,
  zip,
  payor_entity_id,
  payer_id,
  plan_display_name,
  in_network_only = false
} = {}) {
  const find = await findCareNearMe({
    clinic_id,
    specialty,
    zip,
    payor_entity_id,
    payer_id,
    in_network_only
  });
  if (!find.success || !find.providers?.length) {
    return {
      success: false,
      message: find.message || 'I could not find a provider for that need right now.'
    };
  }
  const provider = find.providers[0];
  const copay_hint = getCopayHintForSpecialty(specialty);
  return {
    success: true,
    provider,
    copay_hint,
    match_reason: provider.match_reason,
    narrative: buildRecommendationNarrative({
      careLabel: care_label,
      specialty,
      planName: plan_display_name,
      provider
    })
  };
}

function formatContactOffer(provider) {
  const phone = provider.phone ? `Their number is ${provider.phone}` : 'I do not have a phone number on file for them';
  const hours = provider.hours ? ` and they're open ${provider.hours}` : '';
  return `${phone}${hours}. You can call their office directly when you're ready.`;
}

module.exports = {
  findCareNearMe,
  recommendCare,
  specialtyKeyForSpecialty,
  formatContactOffer,
  buildRecommendationNarrative
};
