/**
 * KellyAgentService — thin facade (modular split under agent/).
 */
'use strict';

const KellyAgentService = require('./agent/kelly-agent-class');
const { KELLY_TOOLS } = require('./agent/kelly-agent-prelude');

module.exports = KellyAgentService;
module.exports.KELLY_TOOLS = KELLY_TOOLS;
