#!/usr/bin/env node
'use strict';

/**
 * Seed navigation demo on pulled GCS DB, clear tenant DID conflict, upload + restart.
 *
 * ⚠️  When PLATFORM_INBOUND_MODE=support (default), this script binds +13639990205 to the
 * operator account — NOT navigation-demo. Do not run expecting navigation PSTN on 363.
 *
 * Usage:
 *   node scripts/navigation-gcs-seed.cjs
 *   node scripts/navigation-gcs-seed.cjs --dry-run
 *   node scripts/navigation-gcs-seed.cjs --phase p3,p4
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
const Database = require('better-sqlite3');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const TENANT_CUSTOMER = process.env.CAPSTONE_CUSTOMER_ID || 'cust_96848972-8121-4ddb-b16c-dc99a2c8ef13';
const dryRun = process.argv.includes('--dry-run');

/** GCS seed always targets pulled prod backup — never local dev DB_PATH from shell. */
function resolveStagingDbPath() {
  const dest =
    process.env.PHASE1_DB_PATH ||
    process.env.NAVIGATION_GCS_DB_PATH ||
    path.join(ROOT, 'backups', 'middleware-staging.db');
  return path.resolve(dest);
}

const { resolveNavCustomerId, resolveNavDid } = require('./lib/navigation-demo-config.cjs');
const NAV_CUSTOMER = resolveNavCustomerId();
const NAV_DID = resolveNavDid();

function pullDb() {
  const dest = resolveStagingDbPath();
  execSync(`bash "${path.join(ROOT, 'scripts', 'phase1-pull-prod-db.sh')}"`, {
    stdio: 'inherit',
    env: { ...process.env, PHASE1_DB_PATH: dest },
  });
  return dest;
}

function childEnv(stagingDb) {
  return {
    ...process.env,
    DB_PATH: stagingDb,
    PHASE1_DB_PATH: stagingDb,
    NAVIGATION_DID: NAV_DID,
  };
}

function ensureNavigationBilling(sqlite) {
  const navMinutes = Number(process.env.NAVIGATION_DEMO_MINUTES || 10000);
  const { resolveNavigationRetellAgentId } = require('../services/navigation/navigation-config');
  const retellAgentId = resolveNavigationRetellAgentId();
  sqlite
    .prepare(
      `UPDATE customers SET
         billing_enforcement_paused = 1,
         billing_enforcement_paused_reason = 'navigation_demo_pitch',
         kelly_status = 'active',
         retell_agent_status = 'active',
         retell_agent_id = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(retellAgentId, NAV_CUSTOMER);

  const credits = sqlite
    .prepare('SELECT credits_balance_minutes FROM customer_credits WHERE customer_id = ?')
    .get(NAV_CUSTOMER);
  if (!credits) {
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO customer_credits (
           id, customer_id, credits_balance_minutes, free_credits_allocated,
           free_credits_expires_at, last_replenished_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`
      )
      .run(crypto.randomBytes(16).toString('hex'), NAV_CUSTOMER, navMinutes, navMinutes, expiresAt);
    console.log(`✅ Navigation billing: paused enforcement + ${navMinutes} minutes`);
    return;
  }
  console.log('↩  Navigation billing credits already present');
}

function assertNavigationBilling(stagingDb) {
  const sqlite = new Database(stagingDb, { readonly: true });
  try {
    const row = sqlite
      .prepare(
        `SELECT billing_enforcement_paused, kelly_status FROM customers WHERE id = ?`
      )
      .get(NAV_CUSTOMER);
    const credits = sqlite
      .prepare('SELECT credits_balance_minutes FROM customer_credits WHERE customer_id = ?')
      .get(NAV_CUSTOMER);
    const paused = row?.billing_enforcement_paused === 1;
    const minutes = credits?.credits_balance_minutes ?? 0;
    if (!paused && minutes <= 0) {
      throw new Error(
        `navigation billing not ready on ${stagingDb}: paused=${row?.billing_enforcement_paused} minutes=${minutes}`
      );
    }
  } finally {
    sqlite.close();
  }
}

function assertDbIntegrity(stagingDb) {
  const sqlite = new Database(stagingDb, { readonly: true });
  try {
    const row = sqlite.pragma('integrity_check', { simple: true });
    if (row !== 'ok') {
      throw new Error(`SQLite integrity_check failed on ${stagingDb}: ${row}`);
    }
  } finally {
    sqlite.close();
  }
}

function assertNavigationReady(stagingDb) {
  const { isPlatformInboundSupportMode } = require('../services/platform-line-config');
  if (isPlatformInboundSupportMode()) {
    const opId =
      process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
      process.env.CALLSOMO_VOICE_CUSTOMER_ID;
    const sqlite = new Database(stagingDb, { readonly: true });
    try {
      if (opId) {
        const op = sqlite
          .prepare('SELECT twilio_phone_number FROM customers WHERE id = ?')
          .get(opId);
        if (op?.twilio_phone_number !== NAV_DID) {
          throw new Error(`operator DID mismatch on ${stagingDb}: ${op?.twilio_phone_number} != ${NAV_DID}`);
        }
      }
      const nav = sqlite
        .prepare('SELECT twilio_phone_number FROM customers WHERE id = ?')
        .get(NAV_CUSTOMER);
      if (nav?.twilio_phone_number === NAV_DID) {
        throw new Error(`navigation-demo still owns ${NAV_DID} on ${stagingDb}`);
      }
    } finally {
      sqlite.close();
    }
    return;
  }
  const sqlite = new Database(stagingDb, { readonly: true });
  try {
    const row = sqlite
      .prepare(
        `SELECT id, customer_type, twilio_phone_number FROM customers WHERE id = ?`
      )
      .get(NAV_CUSTOMER);
    if (!row || row.id !== NAV_CUSTOMER || row.customer_type !== 'navigation') {
      throw new Error(
        `navigation customer missing on ${stagingDb}: ${JSON.stringify(row || null)}`
      );
    }
    if (row.twilio_phone_number !== NAV_DID) {
      throw new Error(`navigation DID mismatch on ${stagingDb}: ${row.twilio_phone_number} != ${NAV_DID}`);
    }
    const conflict = sqlite
      .prepare(`SELECT id FROM customers WHERE twilio_phone_number = ? AND id != ?`)
      .get(NAV_DID, NAV_CUSTOMER);
    if (conflict) {
      throw new Error(`DID ${NAV_DID} still bound to ${conflict.id} on ${stagingDb}`);
    }
  } finally {
    sqlite.close();
  }
}

function clearTenantDidConflict(sqlite) {
  const { isPlatformInboundSupportMode } = require('../services/platform-line-config');
  if (isPlatformInboundSupportMode()) {
    console.log('⏭  Skipping navigation DID rebind — PLATFORM_INBOUND_MODE=support');
    const opId =
      process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
      process.env.CALLSOMO_VOICE_CUSTOMER_ID;
    if (opId) {
      sqlite
        .prepare(
          `UPDATE customers SET twilio_phone_number = NULL, updated_at = datetime('now')
           WHERE twilio_phone_number = ? AND id NOT IN (?, ?)`
        )
        .run(NAV_DID, opId, NAV_CUSTOMER);
      sqlite
        .prepare(
          `UPDATE customers SET twilio_phone_number = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(NAV_DID, opId);
      console.log(`✅ Platform support mode: bound ${NAV_DID} → operator ${opId}`);
    }
    sqlite
      .prepare(
        `UPDATE customers SET twilio_phone_number = NULL, updated_at = datetime('now')
         WHERE id = ? AND twilio_phone_number = ?`
      )
      .run(NAV_CUSTOMER, NAV_DID);
    return;
  }
  const cleared = sqlite
    .prepare(
      `UPDATE customers SET twilio_phone_number = NULL, updated_at = datetime('now')
       WHERE twilio_phone_number = ? AND id != ?`
    )
    .run(NAV_DID, NAV_CUSTOMER);
  if (cleared.changes > 0) {
    console.log(`✅ Cleared ${cleared.changes} customer(s) from navigation DID ${NAV_DID}`);
  }
  const legacyKellyDid = process.env.CAPSTONE_TENANT_DID || '+18623622415';
  if (legacyKellyDid && legacyKellyDid !== NAV_DID) {
    sqlite
      .prepare(
        `UPDATE customers SET twilio_phone_number = NULL, updated_at = datetime('now')
         WHERE id = ? AND twilio_phone_number = ?`
      )
      .run(NAV_CUSTOMER, legacyKellyDid);
  }
  sqlite
    .prepare(
      `UPDATE customers SET twilio_phone_number = ?, customer_type = 'navigation', updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(NAV_DID, NAV_CUSTOMER);
}

function uploadToGcs(dbPath) {
  const mp = path.join(__dirname, '..');
  const abs = path.resolve(dbPath);
  execSync(
    `GCS_DB_BUCKET=${process.env.GCS_DB_BUCKET || 'somo-staging-db-somo-callsomo'} DB_PATH="${abs}" GCS_DB_UPLOAD_FORCE=1 node scripts/cloudrun-db-sync.cjs upload`,
    { cwd: mp, stdio: 'inherit', env: { ...process.env, DB_PATH: abs } }
  );
}

function restartCloudRun() {
  const stamp = `NAV_SEED_${Date.now()}`;
  const navFlag = process.env.PLATFORM_INBOUND_MODE === 'navigation' ? 'NAVIGATION_ENABLED=1' : 'NAVIGATION_ENABLED=0';
  execSync(
    `gcloud run services update somo-middleware --region us-central1 --project somo-callsomo --update-env-vars ${stamp}=1,${navFlag},PLATFORM_INBOUND_MODE=${process.env.PLATFORM_INBOUND_MODE || 'support'}`,
    { stdio: 'inherit' }
  );
  console.log('Waiting 90s for instances to cycle…');
  execSync('sleep 90');
}

function uploadAndRestart(dbPath) {
  uploadToGcs(dbPath);
  restartCloudRun();
}

function main() {
  const stagingDb = dryRun ? resolveStagingDbPath() : pullDb();
  process.env.DB_PATH = stagingDb;
  process.env.PHASE1_DB_PATH = stagingDb;

  if (!fs.existsSync(stagingDb)) {
    console.error(`DB not found: ${stagingDb}`);
    process.exit(2);
  }

  const sizeMb = (fs.statSync(stagingDb).size / (1024 * 1024)).toFixed(1);
  console.log(`📁 GCS seed target: ${stagingDb} (${sizeMb} MiB)`);

  const sqlite = new Database(stagingDb);
  try {
    clearTenantDidConflict(sqlite);
  } finally {
    sqlite.close();
  }

  const phases = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1] || '';
  const seedArgs = ['node', 'scripts/seed-navigation-demo.cjs'];
  if (phases) seedArgs.push(`--phase=${phases}`);

  execSync(seedArgs.join(' '), {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: childEnv(stagingDb),
  });

  execSync('npm run navigation:preflight -- --skip-idempotent', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: childEnv(stagingDb),
  });

  // Re-bind after seed/preflight (idempotent re-seed can race with split-brain DB handles).
  const sqliteRebind = new Database(stagingDb);
  try {
    clearTenantDidConflict(sqliteRebind);
    ensureNavigationBilling(sqliteRebind);
  } finally {
    sqliteRebind.close();
  }

  assertDbIntegrity(stagingDb);
  assertNavigationReady(stagingDb);
  assertNavigationBilling(stagingDb);
  console.log(`✅ Pre-upload check: ${NAV_CUSTOMER} on ${NAV_DID}`);

  if (dryRun) {
    console.log('[dry-run] Skipping GCS upload + restart');
    return;
  }

  uploadAndRestart(stagingDb);

  // Old Cloud Run instances upload stale DB on SIGTERM — re-patch and upload again.
  const sqlite2 = new Database(stagingDb);
  try {
    ensureNavigationBilling(sqlite2);
  } finally {
    sqlite2.close();
  }
  assertNavigationBilling(stagingDb);
  console.log('==> Final GCS upload (after instance drain)…');
  uploadToGcs(stagingDb);

  pullDb();
  const verifyDb = resolveStagingDbPath();
  assertDbIntegrity(verifyDb);
  assertNavigationReady(verifyDb);
  assertNavigationBilling(verifyDb);
  console.log('✅ Navigation GCS seed complete');
  console.log(`   Dial / test PSTN: ${NAV_DID}`);
  console.log(`   Existing Twilio webhook OK (navigation wins on To): /voice/incoming`);
}

main();
