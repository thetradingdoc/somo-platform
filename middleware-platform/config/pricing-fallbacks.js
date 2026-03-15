/**
 * Task 24: Pricing fallbacks moved out of getEffectiveVisitPrice into config.
 * Override via env: PRICING_FALLBACK_GENERAL_CONSULT, PRICING_FALLBACK_THERAPY, etc.
 */
const FALLBACKS = {
  'General Consult': parseFloat(process.env.PRICING_FALLBACK_GENERAL_CONSULT || '69'),
  'Therapy': parseFloat(process.env.PRICING_FALLBACK_THERAPY || '109'),
  'Mental Health Consultation': parseFloat(process.env.PRICING_FALLBACK_MENTAL_HEALTH || '109'),
  'Psychiatry Initial': parseFloat(process.env.PRICING_FALLBACK_PSYCHIATRY_INITIAL || '179'),
  'Psychiatry Follow-up': parseFloat(process.env.PRICING_FALLBACK_PSYCHIATRY_FOLLOWUP || '99')
};

const DEFAULT_FALLBACK = parseFloat(process.env.PRICING_FALLBACK_DEFAULT || '69');

function getPricingFallback(canonicalAppointmentType) {
  return FALLBACKS[canonicalAppointmentType] ?? DEFAULT_FALLBACK;
}

module.exports = {
  FALLBACKS,
  DEFAULT_FALLBACK,
  getPricingFallback
};
