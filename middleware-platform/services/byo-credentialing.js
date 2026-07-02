'use strict';

/**
 * BYO credentialing payload for Stedi 270 requests (EO-P0-8).
 */
function mergeByoCredentialing(eligibilityData = {}) {
  const creds = eligibilityData.byo_credentialing || eligibilityData.credentialing || {};
  const npi = creds.npi || eligibilityData.providerNpi || eligibilityData.npi || process.env.STEDI_PROVIDER_NPI;
  const taxId = creds.tax_id || creds.taxId || eligibilityData.taxId;
  const orgName = creds.organization_name || creds.orgName || eligibilityData.organizationName;

  return {
    ...eligibilityData,
    providerNpi: npi || eligibilityData.providerNpi,
    taxId: taxId || eligibilityData.taxId,
    organizationName: orgName || eligibilityData.organizationName,
    byo_credentialing_applied: !!(npi || taxId || orgName)
  };
}

module.exports = { mergeByoCredentialing };
