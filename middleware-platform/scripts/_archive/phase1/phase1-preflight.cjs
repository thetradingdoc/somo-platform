#!/usr/bin/env node
'use strict';

/**
 * Phase 1 preflight — pull DB, verify tenant site context, report transfer target.
 *
 * Usage:
 *   node scripts/phase1-preflight.cjs
 *   PHASE1_OPERATOR_MOBILE=+1XXXXXXXXXX node scripts/phase1-preflight.cjs --set-transfer
 */

const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'backups', 'middleware-staging.db');
const TENANT_CUSTOMER = 'cust_96848972-8121-4ddb-b16c-dc99a2c8ef13';
const CLINIC_ID = 'clinic-doclittle';
const TENANT_DID = '+18623622415';

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function pullDb() {
  run(`bash "${path.join(ROOT, 'scripts', 'phase1-pull-prod-db.sh')}"`);
}

function verifySiteContext() {
  run(
    `node "${path.join(__dirname, 'verify-tenant-site-context.cjs')}" ` +
      `--customer_id=${TENANT_CUSTOMER} --clinic_id=${CLINIC_ID} --did=${TENANT_DID}`,
    { env: { ...process.env, DB_PATH } }
  );
}

function reportTransferTarget() {
  const db = new Database(DB_PATH, { readonly: true });
  const clinic = db.prepare('SELECT transfer_number, fallback_pstn FROM clinics WHERE clinic_id = ?').get(CLINIC_ID);
  db.close();
  const mobile =
    process.env.PHASE1_OPERATOR_MOBILE ||
    process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN ||
    null;
  console.log('\n==> Transfer target report');
  console.log(`    clinic.transfer_number: ${clinic?.transfer_number || '(unset)'}`);
  console.log(`    clinic.fallback_pstn:   ${clinic?.fallback_pstn || '(unset)'}`);
  console.log(`    env FALLBACK_PSTN:      ${process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN || '(unset)'}`);
  console.log(`    PHASE1_OPERATOR_MOBILE: ${mobile || '(unset — pass for --set-transfer)'}`);
  return { clinic, mobile };
}

function setTransferTarget(mobile) {
  const db = new Database(DB_PATH);
  db.prepare('UPDATE clinics SET transfer_number = ? WHERE clinic_id = ?').run(mobile, CLINIC_ID);
  db.close();
  console.log(`\n✅ Updated ${CLINIC_ID}.transfer_number → ${mobile}`);
  console.log('   Upload: GCS_DB_UPLOAD_FORCE=1 node scripts/cloudrun-db-sync.cjs upload');
  console.log(
    `   Cloud Run: gcloud run services update somo-middleware --region=us-central1 --project=somo-callsomo --update-env-vars CALLSOMO_OPERATOR_FALLBACK_PSTN=${mobile}`
  );
}

function main() {
  const setTransfer = process.argv.includes('--set-transfer');
  pullDb();
  verifySiteContext();
  const { mobile } = reportTransferTarget();
  if (setTransfer) {
    if (!mobile) {
      console.error('\nSet PHASE1_OPERATOR_MOBILE=+1XXXXXXXXXX before --set-transfer');
      process.exit(2);
    }
    setTransferTarget(mobile);
  } else {
    console.log('\nReady for operator calls when transfer target is your answerable mobile.');
    console.log('Set transfer: PHASE1_OPERATOR_MOBILE=+1XXX node scripts/phase1-preflight.cjs --set-transfer');
  }
}

main();
