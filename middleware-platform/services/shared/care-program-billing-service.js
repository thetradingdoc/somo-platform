'use strict';

function resolveCareProgramPricing() {
  return {
    monthly_price_cents: Number(process.env.CARE_PROGRAM_MONTHLY_CENTS || 4900),
    currency: 'USD',
    description: 'Care program subscription (stub pricing)'
  };
}

async function activateCareProgramSubscription(_db, _opts) {
  return { success: false, error: 'care_program_billing_not_configured' };
}

module.exports = {
  resolveCareProgramPricing,
  activateCareProgramSubscription
};
