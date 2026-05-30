#!/usr/bin/env node
'use strict';

/**
 * Staging bootstrap: ensure owner, attach Twilio, configure Retell.
 * Run on Cloud Run Job or locally with staging DB_PATH / POSTGRES_URL.
 *
 *   npm run bootstrap:staging
 *
 * Env: SOMO_OWNER_*, STAGING_OWNER_TWILIO_PHONE, STAGING_OWNER_TWILIO_SID,
 *      PUBLIC_BASE_URL, API_BASE_URL, STAGING_SKIP_RETELL_CONFIGURE=1 to skip Retell.
 */

const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const mp = __dirname.replace(/\/scripts$/, '');

function run(label, cmd, args, extraEnv = {}) {
  console.log(`\n==> ${label}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    cwd: mp
  });
  if (r.status !== 0) {
    console.error(`Bootstrap failed at: ${label}`);
    process.exit(r.status || 1);
  }
}

run('ensure:somo-owner', process.execPath, ['scripts/ensure-somo-owner-account.cjs']);

const db = require('../database');
const email = (process.env.SOMO_OWNER_EMAIL || 'drlittlekids@gmail.com').trim();
const customer = db.getCustomerByEmail(email);
if (!customer) {
  console.error('Owner customer missing after ensure');
  process.exit(1);
}

const phone = (process.env.STAGING_OWNER_TWILIO_PHONE || process.env.SOMO_OWNER_TWILIO_PHONE || '').trim();
const sid = (process.env.STAGING_OWNER_TWILIO_SID || process.env.SOMO_OWNER_TWILIO_SID || '').trim();

if (phone && sid) {
  run('attach Twilio', process.execPath, [
    'scripts/attach-existing-twilio-number.cjs',
    `--customer-id=${customer.id}`,
    `--phone=${phone}`,
    `--twilio-sid=${sid}`,
    '--update-webhook'
  ], {
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || 'https://api.myskinandcare.com'
  });
} else {
  console.warn('Skip Twilio attach — set STAGING_OWNER_TWILIO_PHONE + STAGING_OWNER_TWILIO_SID');
}

if (process.env.STAGING_SKIP_RETELL_CONFIGURE === '1') {
  console.log('Skip Retell configure (STAGING_SKIP_RETELL_CONFIGURE=1)');
} else if (process.env.RETELL_API_KEY) {
  run('configure Retell', process.execPath, ['configure-retell.js'], {
    API_BASE_URL: process.env.API_BASE_URL || 'https://api.myskinandcare.com'
  });
} else {
  console.warn('Skip Retell configure — RETELL_API_KEY not set');
}

console.log('\nStaging bootstrap complete.\n');
