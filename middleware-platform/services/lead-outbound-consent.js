'use strict';

/**
 * TCPA / outbound-dial consent gate for admin CRM scraped leads (F-M6).
 * Scraped numbers lack express consent — block auto-dial until basis is recorded.
 */

/** Consent bases that permit operator-initiated outbound sales calls */
const ALLOWED_OUTBOUND_CONSENT = new Set([
  'inbound_platform',
  'inbound_callback',
  'express_written',
]);

/** Sources that imply inbound consent when basis is set at creation */
const INBOUND_CONSENT_SOURCES = new Set(['inbound_platform']);

function defaultConsentBasisForSource(source) {
  const s = String(source || '').trim().toLowerCase();
  if (INBOUND_CONSENT_SOURCES.has(s)) return 'inbound_platform';
  if (['jsearch', 'craigslist', 'google_search', 'job_search', 'scrape', 'debug_seed'].includes(s)) {
    return 'scrape_public_listing';
  }
  return 'none';
}

function resolveOutboundConsentBasis(lead) {
  if (!lead) return 'none';
  const explicit = String(lead.outbound_consent_basis || '').trim();
  if (explicit) return explicit;
  return defaultConsentBasisForSource(lead.source);
}

function isOutboundCallAllowed(lead, opts = {}) {
  if (opts.allowOverride === true) {
    return { ok: true, basis: resolveOutboundConsentBasis(lead), override: true };
  }
  const basis = resolveOutboundConsentBasis(lead);
  if (ALLOWED_OUTBOUND_CONSENT.has(basis)) {
    return { ok: true, basis };
  }
  return {
    ok: false,
    code: 'TCPA_OUTBOUND_CONSENT_REQUIRED',
    basis,
    requires_review: true,
    message:
      'Outbound call blocked — no TCPA consent basis on file for this lead. ' +
      'Scraped numbers require express consent (record on lead detail) or an inbound platform call first.',
  };
}

function consentPayloadForNewLead(leadData = {}) {
  const basis =
    leadData.outbound_consent_basis ||
    defaultConsentBasisForSource(leadData.source);
  const allowed = ALLOWED_OUTBOUND_CONSENT.has(basis);
  return {
    outbound_consent_basis: basis,
    consent_recorded_at: allowed
      ? leadData.consent_recorded_at || new Date().toISOString()
      : leadData.consent_recorded_at || null,
  };
}

function leadScoreTier(score) {
  const n = Number(score) || 0;
  if (n >= 70) return 'hot';
  if (n >= 40) return 'warm';
  return 'cold';
}

module.exports = {
  ALLOWED_OUTBOUND_CONSENT,
  defaultConsentBasisForSource,
  resolveOutboundConsentBasis,
  isOutboundCallAllowed,
  consentPayloadForNewLead,
  leadScoreTier,
};
