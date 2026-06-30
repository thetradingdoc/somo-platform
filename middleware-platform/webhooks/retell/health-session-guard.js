'use strict';

const { isCommerceLegacyEnabled } = require('../../lib/commerce-legacy-flag');

/**
 * Block legacy commerce tool paths when call metadata references a health session.
 */
function isHealthSessionContext(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return false;
  if (metadata.health_session_id) return true;
  if (metadata.room_id && String(metadata.room_id).startsWith('health-')) return true;
  return false;
}

function shouldBlockCommerceTools(metadata = {}) {
  if (isHealthSessionContext(metadata)) return true;
  if (!isCommerceLegacyEnabled() && metadata?.channel === 'commerce') return true;
  return false;
}

module.exports = {
  isHealthSessionContext,
  shouldBlockCommerceTools
};
