#!/usr/bin/env node
'use strict';

/**
 * Voice HTTP insurance spine — resolveInsuranceCodes must match Kelly executor path.
 */

const { bootstrapVerifyEnv } = require('./lib/verify-env.cjs');
bootstrapVerifyEnv({ codingSpineOnly: true });

const { openAppDb } = require('./lib/verify-db.cjs');
const { seedTriage } = require('./lib/seed-triage.cjs');
const { summarizeChecks } = require('./lib/verify-assert.cjs');
const { resolveInsuranceCodes } = require('../services/resolve-insurance-codes');

const { db } = openAppDb();

async function main() {
  const checks = [];
  const assert = (name, ok, actual, expected) => checks.push({ name, pass: !!ok, actual, expected });

  const sessionId = `voice_http_${Date.now()}`;
  seedTriage(db, sessionId, { icd: 'K29.70', cpt: '99213', confidence: 0.85 });

  const noClientCode = resolveInsuranceCodes(sessionId, {});
  assert('spine_without_client_code', noClientCode.ok && noClientCode.code_source === 'spine', noClientCode.code_source, 'spine');

  const rejected = resolveInsuranceCodes(sessionId, { service_code: '99999' });
  assert('reject_client_service_code', rejected.error_code === 'CLIENT_SERVICE_CODE_REJECTED', rejected.error_code, 'CLIENT_SERVICE_CODE_REJECTED');

  const lowSession = `voice_http_low_${Date.now()}`;
  seedTriage(db, lowSession, { icd: 'K29.70', cpt: '99213', confidence: 0.5 });
  const hitl = resolveInsuranceCodes(lowSession, {});
  assert('low_confidence_hitl', hitl.status === 'CODING_REVIEW_REQUIRED', hitl.status, 'CODING_REVIEW_REQUIRED');

  const summary = summarizeChecks(checks);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
