#!/usr/bin/env node
/**
 * Builds a YAML file for `gcloud run deploy --env-vars-file`.
 * Profiles: CLOUDRUN_PROFILE=staging (default for deploy-to-gcp.sh) | production
 *
 * Staging: durable SQLite path, migrations on boot, no random secrets when USE_GCP_SECRETS=1.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

const MAX_VAR_CHARS = 3000;
const profile = (process.env.CLOUDRUN_PROFILE || 'staging').toLowerCase();
const isStaging = profile === 'staging';
const envPath = path.join(__dirname, '..', '.env');
const stagingExample = path.join(__dirname, '..', '.env.staging.example');
const outPath = process.argv[2] || path.join('/tmp', `cloudrun-env-${Date.now()}.yaml`);
const gcpProject =
  process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'doctor-little-c688d';

const baseUrl =
  process.env.CLOUDRUN_BASE_URL || 'https://api.myskinandcare.com';
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
  'AZURE_COMMUNICATION_CONNECTION_STRING'
];

function loadGcpSecrets() {
  if (process.env.USE_GCP_SECRETS !== '1') return {};
  const out = {};
  for (const name of SECRET_KEYS) {
    const secretId = process.env[`SECRET_${name}`] || `somo-staging-${name.toLowerCase().replace(/_/g, '-')}`;
    try {
      const val = execSync(
        `gcloud secrets versions access latest --secret="${secretId}" --project="${gcpProject}"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (val) out[name] = val;
    } catch {
      // optional per secret
    }
  }
  return out;
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

parsed = { ...parsed, ...loadGcpSecrets() };

const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function secretOrRandom(key, bytes, minLen = 0) {
  const v = parsed[key];
  if (v && String(v).length >= (minLen || 1)) return v;
  if (isStaging && process.env.USE_GCP_SECRETS === '1') {
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
  JWT_SECRET: secretOrRandom('JWT_SECRET', 32, 32),
  ADMIN_PORTAL_SECRET: secretOrRandom('ADMIN_PORTAL_SECRET', 24),
  API_KEY_ENCRYPTION_KEY: secretOrRandom('API_KEY_ENCRYPTION_KEY', 32),
  RETELL_WEBHOOK_SECRET:
    parsed.RETELL_WEBHOOK_SECRET ||
    parsed.RETELL_WEBHOOK_TOKEN ||
    secretOrRandom('RETELL_WEBHOOK_SECRET', 24),
  STRIPE_WEBHOOK_SECRET:
    parsed.STRIPE_WEBHOOK_SECRET ||
    parsed.STRIPEWebhook ||
    parsed.STRIPE_WEBHOOK ||
    secretOrRandom('STRIPE_WEBHOOK_SECRET', 24),
  BASE_URL: baseUrl,
  API_BASE_URL: baseUrl,
  RETELL_LLM_WEBSOCKET_URL: parsed.RETELL_LLM_WEBSOCKET_URL || retellLlmWsUrl,
  DB_PATH: isStaging
    ? process.env.CLOUDRUN_DB_PATH || '/var/data/middleware-staging.db'
    : parsed.DB_PATH || './middleware-dev.db',
  GCS_DB_BUCKET: isStaging ? process.env.GCS_DB_BUCKET || 'somo-staging-db' : parsed.GCS_DB_BUCKET || '',
  SKIP_STARTUP_MIGRATIONS: isStaging ? '0' : parsed.SKIP_STARTUP_MIGRATIONS || '1',
  MIGRATIONS_STRICT: isStaging ? '1' : '0',
  CLOUDRUN_BOOT_DEBUG: parsed.CLOUDRUN_BOOT_DEBUG || (isStaging ? '0' : '1'),
  TRIAL_SIM_FLOW_ENABLED: parsed.TRIAL_SIM_FLOW_ENABLED || (isStaging ? '1' : parsed.TRIAL_SIM_FLOW_ENABLED || '0'),
  SOMO_OWNER_EMAIL: parsed.SOMO_OWNER_EMAIL || 'drlittlekids@gmail.com',
  STAGING: isStaging ? '1' : '0',
  ALLOW_STRIPE_TEST_IN_PRODUCTION: isStaging ? '1' : '0'
};

if (isStaging) {
  delete merged.NGROK_URL;
  delete merged.MERCHANT_SHOP_URL;
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
