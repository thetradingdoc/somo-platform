'use strict';

const SANDBOX_API_BASE = 'https://test.hs1api.com/ascend-gateway/api';
const PROD_API_BASE = 'https://prod.hs1api.com/ascend-gateway/api';
const SANDBOX_TOKEN_URL =
  'https://test.hs1api.com/oauth/client_credential/accesstoken?grant_type=client_credentials';
const PROD_TOKEN_URL =
  'https://prod.hs1api.com/oauth/client_credential/accesstoken?grant_type=client_credentials';

/**
 * Resolve Dentrix credentials: per-clinic pms_config first, then DENTRIX_* env (dev/sandbox).
 */
function resolveDentrixConfig(settings = {}, clinicId = null) {
  const s = settings || {};
  const envName = String(s.environment || process.env.DENTRIX_ENVIRONMENT || 'sandbox').toLowerCase();
  const isProd = envName === 'production' || envName === 'prod';
  return {
    client_id: s.client_id || process.env.DENTRIX_CLIENT_ID || null,
    client_secret: s.client_secret || process.env.DENTRIX_CLIENT_SECRET || null,
    organization_id: s.organization_id || process.env.DENTRIX_ORGANIZATION_ID || null,
    location_id: s.location_id || process.env.DENTRIX_LOCATION_ID || null,
    operatory_id: s.operatory_id || process.env.DENTRIX_OPERATORY_ID || null,
    default_appointment_type_id:
      s.default_appointment_type_id || process.env.DENTRIX_DEFAULT_APPOINTMENT_TYPE_ID || null,
    api_base: s.api_base || process.env.DENTRIX_API_BASE || (isProd ? PROD_API_BASE : SANDBOX_API_BASE),
    token_url: s.token_url || process.env.DENTRIX_TOKEN_URL || (isProd ? PROD_TOKEN_URL : SANDBOX_TOKEN_URL),
    orgmapper_base:
      s.orgmapper_base ||
      process.env.DENTRIX_ORGMAPPER_BASE ||
      (isProd ? 'https://prod.hs1api.com/orgmapper' : 'https://test.hs1api.com/orgmapper'),
    environment: isProd ? 'production' : 'sandbox',
    clinic_id: clinicId
  };
}

function hasDentrixCredentials(config) {
  return !!(config?.client_id && config?.client_secret && config?.organization_id);
}

module.exports = { resolveDentrixConfig, hasDentrixCredentials };
