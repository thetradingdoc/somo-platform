'use strict';

/**
 * Platform company line (+13639990205) — operator / platform_support vs legacy navigation PSTN.
 */

const { phonesMatch } = require('./navigation/navigation-config');

const PLATFORM_DID_DEFAULT = '+13639990205';

function platformInboundMode() {
  const raw = String(process.env.PLATFORM_INBOUND_MODE || 'support').toLowerCase().trim();
  return raw === 'navigation' ? 'navigation' : 'support';
}

function isPlatformInboundSupportMode() {
  return platformInboundMode() === 'support';
}

function platformDid() {
  return (
    process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER ||
    PLATFORM_DID_DEFAULT
  );
}

function isPlatformCompanyDid(normalizedTo) {
  if (!normalizedTo) return false;
  return phonesMatch(normalizedTo, platformDid());
}

module.exports = {
  PLATFORM_DID_DEFAULT,
  platformInboundMode,
  isPlatformInboundSupportMode,
  platformDid,
  isPlatformCompanyDid
};
