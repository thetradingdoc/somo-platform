#!/usr/bin/env node
'use strict';

/**
 * Seed prod GCS SQLite with tenant customer + verified site context for +18623622415.
 * Upload + rolling restart so live Cloud Run picks up bindings.
 *
 * Usage:
 *   node scripts/phase1-tenant-gcs-seed.cjs
 *   node scripts/phase1-tenant-gcs-seed.cjs --dry-run
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'backups', 'middleware-staging.db');
const TENANT_CUSTOMER = process.env.CAPSTONE_CUSTOMER_ID || 'cust_96848972-8121-4ddb-b16c-dc99a2c8ef13';
const TENANT_DID = process.env.CAPSTONE_TENANT_DID || '+18623622415';
const CLINIC_ID = process.env.CAPSTONE_CLINIC_ID || 'clinic-doclittle';
const TENANT_EMAIL = process.env.PHASE1_TENANT_EMAIL || 'tenant.doclittle@callsomo.com';
const dryRun = process.argv.includes('--dry-run');

const { stampTenantSiteContext, assertSiteContextVerdict } = require('./lib/stamp-tenant-site-context.cjs');

function pullDb() {
  execSync(`bash "${path.join(ROOT, 'scripts', 'phase1-pull-prod-db.sh')}"`, { stdio: 'inherit' });
}

function ensureTenantCustomer(sqlite) {
  const existing = sqlite.prepare('SELECT id FROM customers WHERE id = ?').get(TENANT_CUSTOMER);
  if (existing) return;
  const merchantKey = `cust:${TENANT_CUSTOMER}`;
  sqlite
    .prepare(
      `INSERT INTO customers (
        id, name, email, customer_type, status, merchant_id,
        twilio_phone_number, retell_agent_id, plan_tier, created_at, updated_at
      ) VALUES (?, ?, ?, 'tenant', 'active', ?, ?, ?, 'starter', datetime('now'), datetime('now'))`
    )
    .run(
      TENANT_CUSTOMER,
      'Doctor Little Clinic',
      TENANT_EMAIL,
      merchantKey,
      TENANT_DID,
      process.env.RETELL_AGENT_ID || null
    );
  console.log(`Inserted tenant customer ${TENANT_CUSTOMER}`);
}

function seedBookingFixtures(dbPath) {
  const abs = path.resolve(dbPath);
  process.env.DB_PATH = abs;
  process.env.SKIP_STARTUP_MIGRATIONS = '1';
  delete require.cache[require.resolve('../database')];
  const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');
  fixtures.seedE2eBookableProvider(CLINIC_ID, {
    specialty: 'Gastroenterology',
    providerEmail: 'maria.santos@doclittle.example'
  });
  try {
    execSync('node seeds/pilot-payer-rules.js', {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      env: { ...process.env, DB_PATH: abs, SKIP_STARTUP_MIGRATIONS: '1' }
    });
  } catch (e) {
    console.warn('pilot-payer-rules seed skipped:', e.message);
  }
}

function uploadAndRestart(dbPath) {
  const mp = path.join(__dirname, '..');
  const abs = path.resolve(dbPath);
  execSync(
    `GCS_DB_BUCKET=${process.env.GCS_DB_BUCKET || 'somo-staging-db-somo-callsomo'} DB_PATH="${abs}" GCS_DB_UPLOAD_FORCE=1 node scripts/cloudrun-db-sync.cjs upload`,
    { cwd: mp, stdio: 'inherit', env: { ...process.env, DB_PATH: abs } }
  );
  const stamp = `PHASE1_TENANT_SEED_${Date.now()}`;
  execSync(
    `gcloud run services update somo-middleware --region us-central1 --project somo-callsomo --update-env-vars ${stamp}=1`,
    { stdio: 'inherit' }
  );
  console.log('Waiting 90s for instances to cycle…');
  execSync('sleep 90');
}

function main() {
  if (!dryRun) pullDb();
  if (!fs.existsSync(DB_PATH)) {
    console.error(`DB not found: ${DB_PATH}`);
    process.exit(2);
  }

  const sqlite = new Database(DB_PATH);
  try {
    ensureTenantCustomer(sqlite);
    stampTenantSiteContext(sqlite, {
      customerId: TENANT_CUSTOMER,
      clinicId: CLINIC_ID,
      did: TENANT_DID,
      clinicName: 'Doctor Little Clinic'
    });
    sqlite
      .prepare(
        `UPDATE customers SET twilio_phone_number = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(TENANT_DID, TENANT_CUSTOMER);
    sqlite
      .prepare(
        `UPDATE clinics SET transfer_number = COALESCE(transfer_number, ?) WHERE clinic_id = ?`
      )
      .run(process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN || '+12028131474', CLINIC_ID);
  } finally {
    sqlite.close();
  }

  assertSiteContextVerdict(DB_PATH, {
    customerId: TENANT_CUSTOMER,
    clinicId: CLINIC_ID,
    did: TENANT_DID
  });
  console.log('✅ Tenant site-context verified on local GCS copy');

  seedBookingFixtures(DB_PATH);
  console.log('✅ Bookable provider + payer rules seeded');

  if (dryRun) {
    console.log('[dry-run] Skipping GCS upload + restart');
    return;
  }

  uploadAndRestart(DB_PATH);
  pullDb();
  assertSiteContextVerdict(DB_PATH, {
    customerId: TENANT_CUSTOMER,
    clinicId: CLINIC_ID,
    did: TENANT_DID
  });
  console.log('✅ Tenant site-context verified after GCS upload');
}

main();
