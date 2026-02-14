/**
 * Feature flags (Section 15)
 * Env-based flags; optional DB-backed flags via utils/feature-flags.js
 */

const flags = {
  semantic_search_enabled: process.env.SEMANTIC_SEARCH_ENABLED === 'true' || process.env.USE_SEMANTIC_SEARCH === 'true',
  confidence_rejection_enabled: process.env.CONFIDENCE_REJECTION_ENABLED !== 'false',
  langgraph_enabled: process.env.LANGGRAPH_ENABLED !== 'false',
  stedi_circuit_breaker_enabled: process.env.CIRCUIT_BREAKER_STEDI !== 'false',
  groq_circuit_breaker_enabled: process.env.CIRCUIT_BREAKER_GROQ !== 'false',
  clinic_rate_limit_enabled: process.env.CLINIC_RATE_LIMIT_ENABLED !== 'false',
  pii_redaction_enabled: process.env.PII_REDACTION_ENABLED !== 'false',
  token_budget_enabled: process.env.TOKEN_BUDGET_ENABLED !== 'false'
};

function isEnabled(flagName) {
  return !!flags[flagName];
}

function getAll() {
  return { ...flags };
}

module.exports = {
  flags,
  isEnabled,
  getAll
};
