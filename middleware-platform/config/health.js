'use strict';

function flag(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return defaultValue;
  return v === '1' || String(v).toLowerCase() === 'true' || v === 'yes';
}

module.exports = {
  groqApiKey: () => String(process.env.GROQ_API_KEY || '').trim(),
  maxToolRounds: () => parseInt(process.env.HEALTH_MAX_TOOL_ROUNDS || '3', 10),
  maxRagPerTurn: () => parseInt(process.env.HEALTH_MAX_RAG_PER_TURN || '1', 10),
  browserSttOnly: () => flag('HEALTH_BROWSER_STT_ONLY', true),
  serverSttEnabled: () => flag('HEALTH_SERVER_STT_ENABLED', false),
  financeEnabled: () => flag('HEALTH_SESSION_FINANCE_ENABLED', false),
  sseBus: () => String(process.env.HEALTH_SSE_BUS || 'memory').toLowerCase()
};
