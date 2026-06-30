'use strict';

/**
 * Legacy skincare/commerce checkout paths — off by default for health-finance MVP.
 * Set COMMERCE_LEGACY_ENABLED=true to revive public commerce + checkout-chat routes.
 */
function isCommerceLegacyEnabled() {
  const v = process.env.COMMERCE_LEGACY_ENABLED;
  if (v === undefined || v === null || v === '') return false;
  return v === '1' || String(v).toLowerCase() === 'true' || v === 'yes';
}

module.exports = {
  isCommerceLegacyEnabled
};
