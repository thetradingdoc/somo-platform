'use strict';

/**
 * Conditional DentalXChange fallback — enabled only when pilot thin-271 rate exceeds threshold.
 * Phase 2.5: wire real DXC adapter when P2-097 trigger fires.
 */

const THIN_271_TRIGGER_PCT = Number(process.env.DXC_FALLBACK_TRIGGER_PCT || 20);

function shouldUseDentalFallback({ thinRatePct } = {}) {
  return Number(thinRatePct) >= THIN_271_TRIGGER_PCT;
}

async function checkEligibilityWithFallback(eligibilityData, opts = {}) {
  const { runEligibilityOrchestration } = require('./eligibility-orchestrator');
  const orchestrated = await runEligibilityOrchestration({
    ...eligibilityData,
    thinRatePct: opts.thinRatePct
  });
  if (!shouldUseDentalFallback(opts) || orchestrated?.eligibility_quality !== 'thin') {
    return orchestrated;
  }
  return {
    ...orchestrated,
    dxc_fallback_deferred: true,
    message: 'DentalXChange fallback not enabled — thin 271 logged for pilot review'
  };
}

module.exports = {
  shouldUseDentalFallback,
  checkEligibilityWithFallback,
  THIN_271_TRIGGER_PCT
};
