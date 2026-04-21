#!/usr/bin/env node
/**
 * Builds a YAML file for `gcloud run deploy --env-vars-file`.
 * Merges .env with production overrides; omits PORT (Cloud Run injects it).
 * Skips env values over MAX_VAR_CHARS (Cloud Run revision env total limit ~32 KiB).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

const MAX_VAR_CHARS = 3000;
const envPath = path.join(__dirname, '..', '.env');
const outPath = process.argv[2] || path.join('/tmp', `cloudrun-env-${Date.now()}.yaml`);

const baseUrl =
  process.env.CLOUDRUN_BASE_URL || 'https://api.myskinandcare.com';

let parsed = {};
if (fs.existsSync(envPath)) {
  parsed = dotenv.parse(fs.readFileSync(envPath));
} else {
  console.error('No .env at', envPath, '- using generated secrets only.');
}

const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

const merged = {
  ...parsed,
  NODE_ENV: 'production',
  REQUIRE_JWT_FOR_FHIR: '1',
  REQUIRE_TRIAGE_FOR_VOICE: parsed.REQUIRE_TRIAGE_FOR_VOICE || '1',
  JWT_SECRET:
    parsed.JWT_SECRET && String(parsed.JWT_SECRET).length >= 32
      ? parsed.JWT_SECRET
      : randomHex(32),
  ADMIN_PORTAL_SECRET: parsed.ADMIN_PORTAL_SECRET || randomHex(24),
  API_KEY_ENCRYPTION_KEY: parsed.API_KEY_ENCRYPTION_KEY || randomHex(32),
  RETELL_WEBHOOK_SECRET:
    parsed.RETELL_WEBHOOK_SECRET ||
    parsed.RETELL_WEBHOOK_TOKEN ||
    randomHex(24),
  STRIPE_WEBHOOK_SECRET:
    parsed.STRIPE_WEBHOOK_SECRET ||
    parsed.STRIPEWebhook ||
    parsed.STRIPE_WEBHOOK ||
    randomHex(24),
  BASE_URL: baseUrl,
  API_BASE_URL: baseUrl,
  // Cloud Run: prefer pre-seeded DB for faster startup, still writable in container FS.
  DB_PATH: parsed.DB_PATH || './middleware-dev.db',
  // Startup speed guard for Cloud Run: avoid long migration batch during boot.
  SKIP_STARTUP_MIGRATIONS: parsed.SKIP_STARTUP_MIGRATIONS || '1',
  // Cloud Run boot should not hard-fail on legacy migration ordering mismatches.
  MIGRATIONS_STRICT: '0',
  // Temporary startup tracing to isolate Cloud Run boot exits.
  CLOUDRUN_BOOT_DEBUG: parsed.CLOUDRUN_BOOT_DEBUG || '1'
};

delete merged.PORT;

const lines = [];
const skipped = [];
for (const [k, v] of Object.entries(merged)) {
  if (v === undefined || v === null) continue;
  const s = String(v);
  if (s.length > MAX_VAR_CHARS) {
    skipped.push(k);
    continue;
  }
  lines.push(`${k}: ${JSON.stringify(s)}`);
}

fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log('Wrote', outPath, `(${lines.length} vars)`);
if (skipped.length) {
  console.warn(
    'Skipped (too long; set via Secret Manager or shorten):',
    skipped.join(', ')
  );
}
