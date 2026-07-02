'use strict';

/**
 * Resolve Athena credentials: per-clinic pms_config first, then ATHENA_* env (dev/sandbox).
 */
function resolveAthenaConfig(settings = {}, clinicId = null) {
  const s = settings || {};
  return {
    client_id: s.client_id || process.env.ATHENA_CLIENT_ID || null,
    client_secret: s.client_secret || process.env.ATHENA_CLIENT_SECRET || null,
    practice_id: s.practice_id || process.env.ATHENA_PRACTICE_ID || null,
    department_id: s.department_id || process.env.ATHENA_DEPARTMENT_ID || null,
    default_appointmenttype_id:
      s.default_appointmenttype_id ||
      s.appointmenttype_id ||
      process.env.ATHENA_DEFAULT_APPOINTMENTTYPE_ID ||
      null,
    api_base:
      s.api_base ||
      process.env.ATHENA_API_BASE ||
      'https://api.preview.platform.athenahealth.com',
    token_url:
      s.token_url ||
      process.env.ATHENA_TOKEN_URL ||
      'https://api.preview.platform.athenahealth.com/oauth2/v1/token',
    scope: s.scope || process.env.ATHENA_OAUTH_SCOPE || 'athena/service/Athenanet.MDP.*',
    clinic_id: clinicId
  };
}

function hasAthenaCredentials(config) {
  return !!(config?.client_id && config?.client_secret && config?.practice_id);
}

module.exports = { resolveAthenaConfig, hasAthenaCredentials };
