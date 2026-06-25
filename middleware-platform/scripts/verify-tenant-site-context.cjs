#!/usr/bin/env node
'use strict';

/**
 * Verify tenant DID → clinic/customer bind resolves to site_context verified.
 *
 * Usage:
 *   DB_PATH=./backups/live-gcs-check.db node scripts/verify-tenant-site-context.cjs
 *   DB_PATH=./backups/live-gcs-check.db node scripts/verify-tenant-site-context.cjs --json
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  evaluateTenantSiteContext,
  assertSiteContextVerdict
} = require('./lib/stamp-tenant-site-context.cjs');

const jsonOut = process.argv.includes('--json');
const did =
  (process.argv.find((a) => a.startsWith('--did=')) || '').split('=')[1] ||
  process.env.CAPSTONE_TENANT_DID ||
  '+18623622415';
const customerId =
  (process.argv.find((a) => a.startsWith('--customer_id=')) || '').split('=')[1] ||
  process.env.CAPSTONE_CUSTOMER_ID ||
  process.env.CALLSOMO_OPERATOR_CUSTOMER_ID;
const clinicId =
  (process.argv.find((a) => a.startsWith('--clinic_id=')) || '').split('=')[1] ||
  process.env.CAPSTONE_CLINIC_ID ||
  process.env.DEFAULT_CLINIC_ID ||
  'clinic-default';

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return path.resolve(process.cwd(), process.env.DB_PATH);
  }
  const bucket = process.env.GCS_DB_BUCKET;
  if (bucket) {
    const dest = path.join(__dirname, '..', 'backups', 'live-gcs-check.db');
    execSync(`gsutil cp gs://${bucket}/${process.env.GCS_DB_OBJECT || 'middleware-staging.db'} "${dest}"`, {
      stdio: 'inherit'
    });
    return dest;
  }
  return null;
}

function main() {
  const dbPath = resolveDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('DB_PATH or GCS_DB_BUCKET required (file not found)');
    process.exit(2);
  }
  if (!customerId) {
    console.error('CALLSOMO_OPERATOR_CUSTOMER_ID or --customer_id required');
    process.exit(2);
  }

  let integrity = 'unknown';
  try {
    integrity = execSync(`sqlite3 "${dbPath}" "PRAGMA integrity_check;"`, { encoding: 'utf8' }).trim();
  } catch (_) {}

  let result;
  let success = false;
  let error = null;
  try {
    assertSiteContextVerdict(dbPath, { customerId, clinicId, did });
    result = evaluateTenantSiteContext(dbPath, { customerId, clinicId, did });
    success = true;
  } catch (e) {
    error = e.message;
    try {
      result = evaluateTenantSiteContext(dbPath, { customerId, clinicId, did });
    } catch (_) {}
  }

  const summary = {
    success,
    db_path: dbPath,
    integrity,
    did,
    customer_id: customerId,
    clinic_id: clinicId,
    verdict: result?.verdict || null,
    site_context_status: result?.siteContext?.site_context_status || null,
    clinic_id_source: result?.siteContext?.clinic_id_source || null,
    identity_admitted: result?.admission?.admitted ?? null,
    identity_reason: result?.admission?.reason || null,
    error
  };

  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('==> verify-tenant-site-context');
    console.log(`    db: ${dbPath} (integrity: ${integrity})`);
    console.log(`    did: ${did} → clinic ${clinicId}, customer ${customerId}`);
    console.log(`    verdict: ${summary.verdict}`);
    console.log(`    site_context: ${summary.site_context_status} (${summary.clinic_id_source || '—'})`);
    console.log(`    identity_admitted: ${summary.identity_admitted}${summary.identity_reason ? ` (${summary.identity_reason})` : ''}`);
    if (error) console.error(`    error: ${error}`);
  }

  process.exit(success ? 0 : 2);
}

main();
