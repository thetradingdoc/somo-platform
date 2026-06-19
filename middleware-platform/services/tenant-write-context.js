'use strict';

const { effectiveClinicId, buildVoiceCallContext } = require('./voice-call-context');

/**
 * Extract tenant columns for session/case/triage writes from connection or turn opts.
 */
function extractTenantWriteContext(source = {}) {
  const voiceContext =
    source.voiceContext ||
    source.voice_context ||
    (source.site_context_status || source.siteContext
      ? buildVoiceCallContext(source)
      : null);

  const site = source.siteContext || source.site_context || {};
  const clinicId =
    effectiveClinicId(voiceContext) ||
    source.clinicId ||
    source.clinic_id ||
    site.clinic_id ||
    null;
  const customerId =
    source.customerId ||
    source.customer_id ||
    voiceContext?.customer_id ||
    site.customer_id ||
    null;
  const merchantId =
    source.merchantId ||
    source.merchant_id ||
    voiceContext?.merchant_id ||
    site.merchant_id ||
    null;
  const siteContextStatus =
    voiceContext?.site_context_status ||
    source.site_context_status ||
    site.site_context_status ||
    null;

  return {
    clinicId,
    customerId,
    merchantId,
    siteContextStatus,
    voiceContext
  };
}

function tenantWriteAllowed(ctx) {
  const status = String(ctx?.siteContextStatus || '').toLowerCase();
  return status === 'verified' || status === 'not_required';
}

module.exports = {
  extractTenantWriteContext,
  tenantWriteAllowed
};
