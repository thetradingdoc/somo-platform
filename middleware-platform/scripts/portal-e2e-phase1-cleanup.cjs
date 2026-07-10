#!/usr/bin/env node
'use strict';

/**
 * Phase 1 production account cleanup (dry-run default).
 *
 * Usage:
 *   DB_PATH=backups/middleware-staging.db node scripts/portal-e2e-phase1-cleanup.cjs
 *   DB_PATH=... node scripts/portal-e2e-phase1-cleanup.cjs --execute
 *
 * NEVER combine with Playwright in the same job.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'backups', 'middleware-staging.db');
const EXECUTE = process.argv.includes('--execute');

const PROTECTED_CUSTOMERS = new Set([
  'cust-navigation-demo',
  (process.env.CALLSOMO_OPERATOR_CUSTOMER_ID || 'cust_b7c7d3e1-31e6-4fbb-b6fd-8e306a79fad8').trim()
]);

const DOC_LITTLE_CLINIC = process.env.PORTAL_E2E_DOC_LITTLE_CLINIC || 'clinic-doclittle';
const DOC_LITTLE_EMAIL = 'tenant.doclittle@callsomo.com';

function log(msg) {
  console.log(`[phase1-cleanup] ${msg}`);
}

function isJunkCustomer(row) {
  const email = (row.email || '').toLowerCase();
  const id = (row.id || '').toLowerCase();
  const name = (row.company_name || row.name || '').toLowerCase();
  if (email.includes('onboard-e2e-')) return 'onboard-e2e email';
  if (id.startsWith('cust-nav-prov-')) return 'navigation provider stub';
  if (email.includes('.nav@doclittle.example')) return 'navigation provider stub';
  if (email.includes('tenant-clinic-') && email.endsWith('@example.com')) return 'orphan trial stub';
  if (email.endsWith('@example.com') && email.includes('onboard-e2e')) return 'onboard-e2e example';
  if (name === 'api' && email.includes('navigation')) return 'nav api stub';
  if (email.includes('onboard-e2e')) return 'onboard-e2e pattern';
  return null;
}

function archiveDoclittleViaAdmin() {
  process.env.DB_PATH = DB_PATH;
  delete require.cache[require.resolve('../database')];
  delete require.cache[require.resolve('../services/admin-tenant-delete-service')];
  const adminDelete = require('../services/admin-tenant-delete-service');
  return adminDelete.softDelete(DOC_LITTLE_CLINIC, 'portal-e2e-phase1-cleanup');
}

function main() {
  log('=== Phase 1 account cleanup ===');
  log(`database: ${DB_PATH}`);
  log(`execute: ${EXECUTE}`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`DB not found: ${DB_PATH} — run npm run phase1:pull-db first`);
    process.exit(2);
  }

  const backupTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = DB_PATH.replace(/\.db$/, `.pre-cleanup-${backupTag}.db`);
  if (EXECUTE) {
    fs.copyFileSync(DB_PATH, backupPath);
    log(`backup written: ${backupPath}`);
  } else {
    log(`would backup to: ${backupPath}`);
  }

  const db = new Database(DB_PATH);
  const customers = db.prepare('SELECT id, email, company_name, name, twilio_phone_number FROM customers').all();

  log(`\n--- All customers (${customers.length}) ---`);
  customers.forEach((c) => {
    const prot = PROTECTED_CUSTOMERS.has(c.id) ? ' [PROTECTED]' : '';
    log(`  ${c.id}  ${c.email || '(no email)'}  did=${c.twilio_phone_number || '-'}${prot}`);
  });

  const junk = [];
  for (const c of customers) {
    if (PROTECTED_CUSTOMERS.has(c.id)) continue;
    const reason = isJunkCustomer(c);
    if (reason) junk.push({ ...c, reason });
  }

  log(`\n--- Junk rows to delete (${junk.length}) ---`);
  junk.forEach((j) => log(`  DELETE customer ${j.id} (${j.email}) — ${j.reason}`));

  const doclittle = customers.find((c) => (c.email || '').toLowerCase() === DOC_LITTLE_EMAIL);
  const doclittleClinic = db.prepare('SELECT clinic_id, name, archived_at FROM clinics WHERE clinic_id = ?').get(
    DOC_LITTLE_CLINIC
  );

  log(`\n--- Doclittle archive target ---`);
  if (doclittle) log(`  customer: ${doclittle.id} ${doclittle.email} (clinic archived; customer row retained until Somo create)`);
  else log('  customer: not found by email (may already be removed)');
  if (doclittleClinic) {
    log(`  clinic: ${doclittleClinic.clinic_id} archived_at=${doclittleClinic.archived_at || '(active)'}`);
  } else {
    log(`  clinic ${DOC_LITTLE_CLINIC}: not found`);
  }

  const afterCount = customers.length - junk.length;
  log(`\n--- Expected end state ---`);
  log(`  ${afterCount} customer rows (operator + navigation-demo + doclittle until Somo replaces)`);
  log(`  protected: ${[...PROTECTED_CUSTOMERS].join(', ')}`);
  log(`  Somo slot: provision via PW_MODE=create after upload`);

  if (!EXECUTE) {
    log('\ndry-run — pass --execute to apply');
    db.close();
    return;
  }

  db.close();

  const sqlite = new Database(DB_PATH);
  const delUserByEmail = sqlite.prepare('DELETE FROM users WHERE email = ?');
  const delCustomer = sqlite.prepare('DELETE FROM customers WHERE id = ?');

  const tx = sqlite.transaction(() => {
    for (const j of junk) {
      if (j.email) delUserByEmail.run(j.email);
      delCustomer.run(j.id);
      log(`deleted junk ${j.id}`);
    }
  });
  tx();
  sqlite.close();

  try {
    const result = archiveDoclittleViaAdmin();
    log(`archived doclittle clinic: ${JSON.stringify(result)}`);
  } catch (e) {
    console.error(`[phase1-cleanup] doclittle archive failed: ${e.message}`);
    process.exit(1);
  }

  log('\n=== Phase 1 cleanup execute DONE ===');
  log('Next: GCS_DB_UPLOAD_FORCE=1 node scripts/cloudrun-db-sync.cjs upload');
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  main();
}

module.exports = { isJunkCustomer, PROTECTED_CUSTOMERS };
