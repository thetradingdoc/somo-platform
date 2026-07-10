'use strict';

const {
  isOutboundCallAllowed,
  consentPayloadForNewLead,
  defaultConsentBasisForSource,
  leadScoreTier,
  ALLOWED_OUTBOUND_CONSENT,
} = require('../services/lead-outbound-consent');

describe('lead-outbound-consent', () => {
  test('scraped leads default to scrape_public_listing and block dial', () => {
    const basis = defaultConsentBasisForSource('jsearch');
    expect(basis).toBe('scrape_public_listing');
    const gate = isOutboundCallAllowed({ source: 'jsearch', clinic_phone: '+17185551234' });
    expect(gate.ok).toBe(false);
    expect(gate.code).toBe('TCPA_OUTBOUND_CONSENT_REQUIRED');
  });

  test('inbound_platform leads allow outbound dial', () => {
    const gate = isOutboundCallAllowed({
      source: 'inbound_platform',
      outbound_consent_basis: 'inbound_platform',
      clinic_phone: '+17185559999',
    });
    expect(gate.ok).toBe(true);
    expect(gate.basis).toBe('inbound_platform');
  });

  test('express_written consent allows dial', () => {
    const gate = isOutboundCallAllowed({
      source: 'jsearch',
      outbound_consent_basis: 'express_written',
      clinic_phone: '+17185551234',
    });
    expect(gate.ok).toBe(true);
  });

  test('consentPayloadForNewLead stamps inbound platform consent', () => {
    const payload = consentPayloadForNewLead({ source: 'inbound_platform' });
    expect(payload.outbound_consent_basis).toBe('inbound_platform');
    expect(payload.consent_recorded_at).toBeTruthy();
  });

  test('consentPayloadForNewLead does not stamp scrape consent time', () => {
    const payload = consentPayloadForNewLead({ source: 'craigslist' });
    expect(payload.outbound_consent_basis).toBe('scrape_public_listing');
    expect(payload.consent_recorded_at).toBeNull();
  });

  test('leadScoreTier hot/warm/cold', () => {
    expect(leadScoreTier(80)).toBe('hot');
    expect(leadScoreTier(50)).toBe('warm');
    expect(leadScoreTier(5)).toBe('cold');
  });

  test('ALLOWED_OUTBOUND_CONSENT excludes scrape basis', () => {
    expect(ALLOWED_OUTBOUND_CONSENT.has('scrape_public_listing')).toBe(false);
    expect(ALLOWED_OUTBOUND_CONSENT.has('inbound_platform')).toBe(true);
  });
});
