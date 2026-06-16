#!/usr/bin/env node
/**
 * Builds a YAML file for `gcloud run deploy --env-vars-file`.
 * When USE_GCP_SECRETS=1, secret-backed vars are written to a separate
 * comma-separated file for `gcloud run deploy --set-secrets` (not inlined).
 *
 * Profiles: CLOUDRUN_PROFILE=staging (default) | production
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

const MAX_VAR_CHARS = 3000;
const profile = (process.env.CLOUDRUN_PROFILE || 'staging').toLowerCase();
const isStaging = profile === 'staging';
const useGcpSecrets = process.env.USE_GCP_SECRETS === '1';
const envPath = path.join(__dirname, '..', '.env');
const stagingExample = path.join(__dirname, '..', '.env.staging.example');
const outPath = process.argv[2] || path.join('/tmp', `cloudrun-env-${Date.now()}.yaml`);
const secretsOutPath = process.argv[3] || process.env.CLOUDRUN_SECRETS_FILE || '';
const gcpProject =
  process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'somo-callsomo';

const baseUrl =
  process.env.CLOUDRUN_BASE_URL || 'https://api.callsomo.com';
const retellLlmWsUrl =
  process.env.RETELL_LLM_WEBSOCKET_URL ||
  `${String(baseUrl).replace(/\/+$/, '').replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')}/webhook/retell/llm`;

const SECRET_KEYS = [
  'JWT_SECRET',
  'ADMIN_PORTAL_SECRET',
  'API_KEY_ENCRYPTION_KEY',
  'RETELL_WEBHOOK_SECRET',
  'RETELL_WEBHOOK_TOKEN',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_VERIFY_SERVICE_SID',
  'SOMO_OWNER_PASSWORD',
  'POSTGRES_URL',
  'SMTP_PASSWORD',
  'AZURE_COMMUNICATION_CONNECTION_STRING',
  'RETELL_API_KEY',
  'RETELL_AGENT_ID'
];

function secretIdForEnv(name) {
  const overrides = {
    SMTP_PASSWORD: process.env.SECRET_SMTP_PASSWORD || 'somo-smtp-password'
  };
  if (overrides[name]) return overrides[name];
  return process.env[`SECRET_${name}`] || `somo-staging-${name.toLowerCase().replace(/_/g, '-')}`;
}

function secretExists(secretId) {
  try {
    execSync(`gcloud secrets describe "${secretId}" --project="${gcpProject}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function buildSecretBindings() {
  if (!useGcpSecrets) return [];
  const bindings = [];
  for (const name of SECRET_KEYS) {
    const secretId = secretIdForEnv(name);
    if (secretExists(secretId)) {
      bindings.push(`${name}=${secretId}:latest`);
    }
  }
  return bindings;
}

let parsed = {};
if (fs.existsSync(envPath)) {
  parsed = dotenv.parse(fs.readFileSync(envPath));
} else if (fs.existsSync(stagingExample)) {
  parsed = dotenv.parse(fs.readFileSync(stagingExample));
  console.warn('No .env — loaded non-secret defaults from .env.staging.example');
} else {
  console.error('No .env at', envPath);
}

const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function secretOrRandom(key, bytes, minLen = 0) {
  if (useGcpSecrets && SECRET_KEYS.includes(key)) return '';
  const v = parsed[key];
  if (v && String(v).length >= (minLen || 1)) return v;
  if (isStaging && useGcpSecrets) {
    console.warn(`Missing secret ${key} — set in GCP Secret Manager (somo-staging-*)`);
    return '';
  }
  if (isStaging) {
    console.warn(`Missing ${key} — deploy with USE_GCP_SECRETS=1 or set in local .env`);
  }
  return randomHex(bytes);
}

const merged = {
  ...parsed,
  NODE_ENV: 'production',
  REQUIRE_JWT_FOR_FHIR: parsed.REQUIRE_JWT_FOR_FHIR || '1',
  REQUIRE_TRIAGE_FOR_VOICE: parsed.REQUIRE_TRIAGE_FOR_VOICE || '1',
  BASE_URL: baseUrl,
  API_BASE_URL: baseUrl,
  BASE_DOMAIN: parsed.BASE_DOMAIN || 'callsomo.com',
  RETELL_LLM_WEBSOCKET_URL: parsed.RETELL_LLM_WEBSOCKET_URL || retellLlmWsUrl,
  DB_PATH:
    process.env.CLOUDRUN_DB_PATH ||
    parsed.DB_PATH ||
    '/var/data/middleware-staging.db',
  GCS_DB_BUCKET:
    process.env.GCS_DB_BUCKET ||
    parsed.GCS_DB_BUCKET ||
    'somo-staging-db-somo-callsomo',
  // Cloud Run API must run startup migrations (demo tables, billing, etc.). CLI scripts set SKIP_STARTUP_MIGRATIONS=1 locally only.
  SKIP_STARTUP_MIGRATIONS: '0',
  MIGRATIONS_STRICT: isStaging ? '1' : '0',
  CLOUDRUN_BOOT_DEBUG: parsed.CLOUDRUN_BOOT_DEBUG || (isStaging ? '0' : '1'),
  TRIAL_SIM_FLOW_ENABLED: parsed.TRIAL_SIM_FLOW_ENABLED || (isStaging ? '1' : parsed.TRIAL_SIM_FLOW_ENABLED || '0'),
  SAAS_VOICE_FAIL_CLOSED: parsed.SAAS_VOICE_FAIL_CLOSED || (isStaging ? '1' : parsed.SAAS_VOICE_FAIL_CLOSED || '1'),
  SOMO_OWNER_EMAIL: parsed.SOMO_OWNER_EMAIL || 'richard@callsomo.com',
  CALLSOMO_OPERATOR_CUSTOMER_ID:
    parsed.CALLSOMO_OPERATOR_CUSTOMER_ID ||
    parsed.CALLSOMO_VOICE_CUSTOMER_ID ||
    '',
  CALLSOMO_VOICE_CUSTOMER_ID:
    parsed.CALLSOMO_VOICE_CUSTOMER_ID ||
    parsed.CALLSOMO_OPERATOR_CUSTOMER_ID ||
    '',
  CALLSOMO_OPERATOR_TWILIO_NUMBER:
    parsed.CALLSOMO_OPERATOR_TWILIO_NUMBER ||
    parsed.TWILIO_PHONE_NUMBER ||
    '',
  TWILIO_OUTBOUND_WEBHOOK_URL: parsed.TWILIO_OUTBOUND_WEBHOOK_URL || baseUrl,
  PUBLIC_API_BASE_URL: parsed.PUBLIC_API_BASE_URL || baseUrl,
  CONVERSATION_MODE_ROUTING: parsed.CONVERSATION_MODE_ROUTING || 'shadow',
  CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND:
    parsed.CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND ??
    (isStaging ? '0' : '1'),
  CONVERSATION_MODE_ENFORCE_OUTBOUND_SALES:
    parsed.CONVERSATION_MODE_ENFORCE_OUTBOUND_SALES ??
    (isStaging ? '0' : '1'),
  CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN:
    parsed.CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN ??
    (isStaging ? '0' : '0'),
  CONVERSATION_MODE_ENFORCE_DEMO_QUAL:
    parsed.CONVERSATION_MODE_ENFORCE_DEMO_QUAL || '0',
  STAGING: isStaging ? '1' : '0',
  ALLOW_STRIPE_TEST_IN_PRODUCTION: isStaging ? '1' : '0',
  EMAIL_PROVIDER: parsed.EMAIL_PROVIDER || (isStaging ? 'smtp' : parsed.EMAIL_PROVIDER || 'auto'),
  SMTP_HOST: parsed.SMTP_HOST || (isStaging ? 'smtp.gmail.com' : ''),
  SMTP_PORT: parsed.SMTP_PORT || (isStaging ? '587' : ''),
  SMTP_USER: parsed.SMTP_USER || (isStaging ? 'richard@callsomo.com' : ''),
  SMTP_FROM: parsed.SMTP_FROM || parsed.SMTP_USER || (isStaging ? 'Somo <richard@callsomo.com>' : '')
};

if (!useGcpSecrets) {
  merged.JWT_SECRET = secretOrRandom('JWT_SECRET', 32, 32);
  merged.ADMIN_PORTAL_SECRET = secretOrRandom('ADMIN_PORTAL_SECRET', 24);
  merged.API_KEY_ENCRYPTION_KEY = secretOrRandom('API_KEY_ENCRYPTION_KEY', 32);
  merged.RETELL_WEBHOOK_SECRET =
    parsed.RETELL_WEBHOOK_SECRET ||
    parsed.RETELL_WEBHOOK_TOKEN ||
    secretOrRandom('RETELL_WEBHOOK_SECRET', 24);
  merged.STRIPE_WEBHOOK_SECRET =
    parsed.STRIPE_WEBHOOK_SECRET ||
    parsed.STRIPEWebhook ||
    parsed.STRIPE_WEBHOOK ||
    secretOrRandom('STRIPE_WEBHOOK_SECRET', 24);
}

if (!isStaging) {
  merged.KELLY_RAILS_V2 = parsed.KELLY_RAILS_V2 || '1';
  merged.KELLY_RAILS_ROLLOUT_PCT = parsed.KELLY_RAILS_ROLLOUT_PCT ?? '1';
  merged.KELLY_ALLOW_HYBRID_GRAPH = parsed.KELLY_ALLOW_HYBRID_GRAPH ?? '0';
  merged.KELLY_RAILS_FAST_RAG = parsed.KELLY_RAILS_FAST_RAG ?? '1';
  merged.KELLY_VOICE_FILLER_MS = parsed.KELLY_VOICE_FILLER_MS ?? '1200';
}

if (isStaging) {
  delete merged.NGROK_URL;
  delete merged.MERCHANT_SHOP_URL;
  delete merged.AZURE_COMMUNICATION_CONNECTION_STRING;
  delete merged.AZURE_EMAIL_SENDER;
}

for (const key of SECRET_KEYS) {
  delete merged[key];
}

delete merged.PORT;

const lines = [];
const skipped = [];
for (const [k, v] of Object.entries(merged)) {
  if (v === undefined || v === null || v === '') continue;
  const s = String(v);
  if (s.length > MAX_VAR_CHARS) {
    skipped.push(k);
    continue;
  }
  lines.push(`${k}: ${JSON.stringify(s)}`);
}

fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log('Wrote', outPath, `(${lines.length} vars, profile=${profile})`);
if (skipped.length) {
  console.warn('Skipped (too long):', skipped.join(', '));
}

const secretBindings = buildSecretBindings();
if (secretsOutPath) {
  if (secretBindings.length) {
    fs.writeFileSync(secretsOutPath, secretBindings.join(','), 'utf8');
    console.log('Wrote', secretsOutPath, `(${secretBindings.length} secret bindings)`);
  } else {
    fs.writeFileSync(secretsOutPath, '', 'utf8');
  }
}
