#!/usr/bin/env node
'use strict';

/**
 * N-08 — concurrent coding spine smoke (SQLite resolver path).
 */

const { resolveVisitCodingPath } = require('../services/resolve-visit-codes');
const { resolveAdminInsuranceCodes } = require('../services/resolve-admin-visit-codes');

async function one(i) {
  const path = resolveVisitCodingPath({
    triagePolicy: 'disabled',
    visitReason: i % 2 ? 'dental cleaning' : 'annual checkup',
    tenantSpecialty: i % 2 ? 'Dental' : 'healthcare_clinic'
  });
  const admin = resolveAdminInsuranceCodes({
    visit_reason: i % 2 ? 'dental cleaning' : 'therapy session',
    tenantSpecialty: i % 2 ? 'Dental' : 'healthcare_clinic'
  });
  return { path: path.path, adminOk: admin.ok };
}

async function main() {
  const n = parseInt(process.env.LOAD_CODING_CONCURRENCY || '20', 10);
  const start = Date.now();
  const results = await Promise.all(Array.from({ length: n }, (_, i) => one(i)));
  const ms = Date.now() - start;
  const failed = results.filter((r) => !r.adminOk && r.path.includes('ADMIN')).length;
  console.log(JSON.stringify({ concurrency: n, elapsed_ms: ms, failed, pass: failed === 0 }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
