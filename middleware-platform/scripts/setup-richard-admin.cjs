#!/usr/bin/env node
/**
 * One-time operator admin setup for richard@callsomo.com:
 * - Migrate email from drlittlekids@gmail.com (if present)
 * - Set operator password + capabilities
 * - Attach Twilio outbound line
 * - Remove legacy drlittlekids@gmail.com row when safe
 * - Upload GCS DB snapshot
 *
 * Usage (from middleware-platform/):
 *   node scripts/setup-richard-admin.cjs
 *   node scripts/setup-richard-admin.cjs --password='YourSecurePass123!'
 *   node scripts/setup-richard-admin.cjs --update-gcp-password-secret
 */
'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { OPERATOR_CAPABILITIES } = require('../services/platform/customer-capabilities');

const TARGET_EMAIL = (process.env.SOMO_OWNER_EMAIL || 'richard@callsomo.com').trim().toLowerCase();
const LEGACY_EMAIL = 'drlittlekids@gmail.com';
const OPERATOR_ID =
  process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
  process.env.CALLSOMO_VOICE_CUSTOMER_ID ||
  'cust_b7c7d3e1-31e6-4fbb-b6fd-8e306a79fad8';
const TWILIO_PHONE = (
  process.env.STAGING_OWNER_TWILIO_PHONE ||
  process.env.SOMO_OWNER_CLINIC_PHONE ||
  process.env.TWILIO_PHONE_NUMBER ||
  '+13639990205'
).replace(/\s+/g, '');
const TWILIO_SID =
  process.env.STAGING_OWNER_TWILIO_SID ||
  process.env.SOMO_OWNER_TWILIO_SID ||
  process.env.TWILIO_PHONE_SID ||
  'PNa74666cb828d4fa385df5d74292fd18e';

function parseArgs() {
  const out = { updateGcpSecret: false, dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--update-gcp-password-secret') out.updateGcpSecret = true;
    if (arg === '--dry-run') out.dryRun = true;
    if (arg.startsWith('--password=')) out.password = arg.slice('--password='.length);
  }
  return out;
}

function syncDb(action) {
  if (!process.env.GCS_DB_BUCKET) return;
  console.log(`\n==> GCS DB ${action}`);
  const r = spawnSync(process.execPath, ['scripts/cloudrun-db-sync.cjs', action], {
    stdio: 'inherit',
    env: process.env
  });
  if (r.status !== 0 && action === 'download') {
    console.warn('GCS download failed — continuing with local DB path');
  }
}

async function hashPassword(password) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hash(password, 10);
}

function removeLegacyCustomer(sqlite, legacy) {
  if (!legacy || legacy.email?.toLowerCase() === TARGET_EMAIL) return;
  if (legacy.id === OPERATOR_ID) return;
  console.log(`Removing legacy operator row: ${legacy.email} (${legacy.id})`);
  try {
    if (db.deleteCustomerSessions) db.deleteCustomerSessions(legacy.id);
  } catch (_) {}
  try {
    sqlite.prepare('DELETE FROM email_verification_codes WHERE customer_id = ?').run(legacy.id);
  } catch (_) {}
  sqlite.prepare('DELETE FROM customers WHERE id = ?').run(legacy.id);
}

async function main() {
  const args = parseArgs();
  const password =
    args.password ||
    process.env.SOMO_OWNER_PASSWORD ||
    `Somo-${crypto.randomBytes(4).toString('hex')}!`;

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  await syncDb('download');

  const sqlite = db.db || db;
  let operator = db.getCustomer(OPERATOR_ID);
  const legacy = db.getCustomerByEmail(LEGACY_EMAIL);
  const targetExisting = db.getCustomerByEmail(TARGET_EMAIL);

  if (!operator && legacy) {
    operator = legacy;
    console.log(`Using legacy row ${legacy.id} as operator base`);
  }
  if (!operator && targetExisting) {
    operator = targetExisting;
  }

  if (!operator) {
    db.createCustomer({
      id: OPERATOR_ID,
      name: (process.env.SOMO_OWNER_NAME || 'Richard').trim(),
      email: TARGET_EMAIL,
      phone_number: TWILIO_PHONE,
      plan_tier: 'practice',
      status: 'active',
      email_verified: true,
      email_verified_at: new Date().toISOString()
    });
    operator = db.getCustomer(OPERATOR_ID);
    console.log(`Created operator customer: ${OPERATOR_ID}`);
  }

  const passwordHash = await hashPassword(password);
  const patch = {
    email: TARGET_EMAIL,
    name: process.env.SOMO_OWNER_NAME || operator.name || 'Richard',
    password_hash: passwordHash,
    customer_type: 'operator',
    capabilities: JSON.stringify(OPERATOR_CAPABILITIES),
    billing_enforcement_paused: 1,
    email_verified: 1,
    email_verified_at: operator.email_verified_at || new Date().toISOString(),
    status: 'active',
    phone_number: TWILIO_PHONE,
    twilio_phone_number: TWILIO_PHONE,
    twilio_phone_sid: TWILIO_SID,
    kelly_status: operator.kelly_status || 'active',
    retell_agent_status: operator.retell_agent_status || 'active'
  };

  if (operator.id !== OPERATOR_ID) {
    console.warn(`Operator row id ${operator.id} differs from CALLSOMO_OPERATOR_CUSTOMER_ID=${OPERATOR_ID}`);
    console.warn('Update Cloud Run CALLSOMO_OPERATOR_CUSTOMER_ID to match the DB row you keep.');
  } else {
    patch.id = OPERATOR_ID;
  }

  if (args.dryRun) {
    console.log('[dry-run] Would update operator:', { ...patch, password_hash: '(hash)' });
  } else {
    db.updateCustomer(operator.id, patch);
    operator = db.getCustomer(operator.id);
  }

  if (!db.getCustomerCredits(operator.id)) {
    db.allocateFreeCredits(operator.id, 10000);
    console.log('Allocated 10000 operator minutes.');
  }

  try {
    if (!db.hasAcceptedTerms(operator.id, '1.0')) {
      db.acceptTerms(operator.id, '1.0', 'setup-richard-admin', 'cli');
    }
  } catch (_) {}

  if (legacy) {
    removeLegacyCustomer(sqlite, legacy);
  }

  if (!args.dryRun && TWILIO_PHONE && TWILIO_SID) {
    const base = (process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || 'https://api.callsomo.com').replace(
      /\/$/,
      ''
    );
    const r = spawnSync(
      process.execPath,
      [
        'scripts/attach-existing-twilio-number.cjs',
        `--customer-id=${operator.id}`,
        `--phone=${TWILIO_PHONE}`,
        `--twilio-sid=${TWILIO_SID}`,
        '--update-webhook'
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          PUBLIC_BASE_URL: base,
          API_BASE_URL: base
        }
      }
    );
    if (r.status !== 0) {
      console.warn('Twilio attach script failed — verify webhooks manually');
    }
  }

  if (!args.dryRun) {
    await syncDb('upload');
  }

  console.log('\n✅ Operator admin ready');
  console.log(`   customer_id: ${operator.id}`);
  console.log(`   email:       ${TARGET_EMAIL}`);
  console.log(`   twilio:      ${TWILIO_PHONE} (${TWILIO_SID})`);
  console.log(`   password:    ${password}`);
  console.log('\nSign in:');
  console.log('  Admin portal: https://callsomo.com/admin');
  console.log('  Provider login (voice/CRM): https://callsomo.com/login');
  console.log('\nAdmin portal uses email + password, then a verification code emailed to you.');

  if (args.updateGcpSecret && !args.dryRun) {
    const project = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'somo-callsomo';
    const secretId = process.env.SECRET_SOMO_OWNER_PASSWORD || 'somo-staging-somo-owner-password';
    console.log(`\n==> Updating GCP secret ${secretId}`);
    const r = spawnSync(
      'gcloud',
      ['secrets', 'versions', 'add', secretId, '--project', project, '--data-file', '-'],
      { input: password, encoding: 'utf8' }
    );
    if (r.status !== 0) {
      console.warn('Failed to update GCP password secret — set manually');
    } else {
      console.log('GCP password secret updated.');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
