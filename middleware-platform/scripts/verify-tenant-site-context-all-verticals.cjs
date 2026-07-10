#!/usr/bin/env node
'use strict';

/**
 * Phase 7.4 — verify site_context for every use_case vertical.
 *
 * Usage:
 *   GCS_DB_BUCKET=... node scripts/verify-tenant-site-context-all-verticals.cjs --pull
 *   node scripts/verify-tenant-site-context-all-verticals.cjs --json
 *
 * Per-vertical env (customer_id + clinic_id + did):
 *   SITE_CTX_DENTAL_CUSTOMER_ID, SITE_CTX_DENTAL_CLINIC_ID, SITE_CTX_DENTAL_DID
 *   SITE_CTX_DERM_*, SITE_CTX_HC_*, SITE_CTX_SB_*
 */

const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pullProdDbFromGcs, resolvePulledProdDbPath } = require('./lib/verify-db.cjs');

const VERTICALS = [
  {
    use_case: 'dental',
    customerId: () => process.env.SITE_CTX_DENTAL_CUSTOMER_ID || process.env.CAPSTONE_CUSTOMER_ID,
    clinicId: () => process.env.SITE_CTX_DENTAL_CLINIC_ID || process.env.CAPSTONE_CLINIC_ID || process.env.DEFAULT_CLINIC_ID,
    did: () => process.env.SITE_CTX_DENTAL_DID || process.env.CAPSTONE_TENANT_DID || '+18623622415'
  },
  {
    use_case: 'dermatology',
    customerId: () => process.env.SITE_CTX_DERM_CUSTOMER_ID,
    clinicId: () => process.env.SITE_CTX_DERM_CLINIC_ID,
    did: () => process.env.SITE_CTX_DERM_DID
  },
  {
    use_case: 'healthcare_clinic',
    customerId: () => process.env.SITE_CTX_HC_CUSTOMER_ID,
    clinicId: () => process.env.SITE_CTX_HC_CLINIC_ID,
    did: () => process.env.SITE_CTX_HC_DID
  },
  {
    use_case: 'small_business',
    customerId: () => process.env.SITE_CTX_SB_CUSTOMER_ID,
    clinicId: () => process.env.SITE_CTX_SB_CLINIC_ID,
    did: () => process.env.SITE_CTX_SB_DID
  }
];

function resolveDbPath() {
  if (process.argv.includes('--pull')) {
    return pullProdDbFromGcs();
  }
  return process.env.DB_PATH || resolvePulledProdDbPath();
}

function main() {
  const jsonOut = process.argv.includes('--json');
  const only = (process.argv.find((a) => a.startsWith('--use_case=')) || '').split('=')[1];
  const dbPath = resolveDbPath();
  const report = { db_path: dbPath, verticals: [], pass: true, skipped: [] };

  for (const v of VERTICALS) {
    if (only && v.use_case !== only) continue;

    const customerId = v.customerId();
    const clinicId = v.clinicId();
    const did = v.did();

    if (!customerId || !clinicId || !did) {
      report.skipped.push({
        use_case: v.use_case,
        reason: 'missing SITE_CTX_* env — set customer_id, clinic_id, did for this vertical'
      });
      continue;
    }

    let success = false;
    let error = null;
    let result = null;
    try {
      assertSiteContextVerdict(dbPath, { customerId, clinicId, did });
      result = evaluateTenantSiteContext(dbPath, { customerId, clinicId, did });
      success = true;
    } catch (e) {
      error = e.message;
      try {
        result = evaluateTenantSiteContext(dbPath, { customerId, clinicId, did });
      } catch (_) {}
      report.pass = false;
    }

    const row = {
      use_case: v.use_case,
      success,
      customer_id: customerId,
      clinic_id: clinicId,
      did,
      verdict: result?.verdict || null,
      site_context_status: result?.siteContext?.site_context_status || null,
      error
    };
    report.verticals.push(row);
    if (!jsonOut) {
      const icon = success ? '✅' : '❌';
      console.log(`${icon} ${v.use_case}: ${row.verdict || error}`);
    }
  }

  if (report.verticals.length === 0 && report.skipped.length === VERTICALS.length) {
    console.error('No vertical env configured. Set SITE_CTX_<VERTICAL>_* vars or use --use_case=dental with CAPSTONE_*.');
    process.exit(2);
  }

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nverified: ${report.verticals.filter((r) => r.success).length}/${report.verticals.length}`);
    if (report.skipped.length) {
      console.log(`skipped: ${report.skipped.map((s) => s.use_case).join(', ')}`);
    }
  }

  process.exit(report.pass ? 0 : 1);
}

main();
