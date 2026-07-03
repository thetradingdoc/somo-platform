#!/usr/bin/env node
'use strict';

/**
 * Vendor-only pending blockers — Stedi prod + Dentrix sandbox (informational gate).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function main() {
  const strict = truthy(process.env.STRICT);
  console.log('\n=== Vendor pending readiness ===\n');

  const pending = [];
  const ready = [];

  const stediKey = (process.env.STEDI_API_KEY || '').trim();
  const stediTest = truthy(process.env.STEDI_TEST_MODE);
  const stediProdKey = Boolean(stediKey && !stediKey.startsWith('test_'));
  if (stediProdKey && !stediTest) {
    ready.push('Stedi production key + STEDI_TEST_MODE=0');
  } else {
    pending.push('Stedi prod: fund account, BAA, NPI enrollment, prod API key (npm run setup:phase2-prod-stedi)');
  }

  const dentrixCreds =
    process.env.DENTRIX_CLIENT_ID &&
    process.env.DENTRIX_CLIENT_SECRET &&
    process.env.DENTRIX_ORGANIZATION_ID;
  if (dentrixCreds) {
    const verify = spawnSync('node', ['scripts/verify-phase3-dentrix-sandbox.cjs'], {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, SKIP_DENTRIX_SETUP: '1' }
    });
    if (verify.status === 0) {
      ready.push('Dentrix sandbox connected');
    } else {
      pending.push('Dentrix sandbox creds set but verify:phase3-dentrix failed');
    }
  } else {
    pending.push('Dentrix: Henry Schein API Exchange approval (npm run setup:henry-schein-application)');
  }

  for (const r of ready) console.log(`✅ ${r}`);
  for (const p of pending) console.log(`⏳ ${p}`);

  console.log(`\n${pending.length ? `${pending.length} vendor blocker(s) remain` : 'No vendor blockers detected'}\n`);
  if (strict && pending.length) process.exit(1);
}

main();
