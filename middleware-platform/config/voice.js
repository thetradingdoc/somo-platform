'use strict';

module.exports = {
  kellyRailsV2: () => process.env.KELLY_RAILS_V2 === '1',
  conversationModeEnforce: () => String(process.env.CONVERSATION_MODE_ROUTING || '').toLowerCase() === 'enforce'
};
