'use strict';

/**
 * Legacy derm / skincare / commerce patient surfaces — off by default for front-desk MVP.
 * Set LEGACY_SURFACES_ENABLED=true to mount public funnel, routine, and patient shelf routes.
 */
function isLegacySurfacesEnabled() {
  const v = process.env.LEGACY_SURFACES_ENABLED;
  if (v === undefined || v === null || v === '') return false;
  return v === '1' || String(v).toLowerCase() === 'true' || v === 'yes';
}

module.exports = {
  isLegacySurfacesEnabled
};
