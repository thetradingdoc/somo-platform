#!/usr/bin/env node
'use strict';

/**
 * Phase 1 G — post-call verification for a real session (no harness seeds).
 * Usage: node scripts/verify-live-call.cjs --session_id=<ID> [--json]
 */

const { bootstrapVerifyEnv } = require('./lib/verify-env.cjs');
bootstrapVerifyEnv();

const { parseVerifyArgs } = require('./lib/verify-args.cjs');
const { summarizeChecks, printChecksAndExit } = require('./lib/verify-assert.cjs');
const { openAppDb } = require('./lib/verify-db.cjs');
const { ensureHarnessMigration081 } = require('./lib/verify-migrations.cjs');
const { runCodingSpinePostCallChecks, CODING_CONFIDENCE_THRESHOLD } = require('./lib/coding-spine-checks.cjs');

const { sessionId, jsonOut } = parseVerifyArgs();
if (!sessionId) {
  console.error('Usage: node scripts/verify-live-call.cjs --session_id=<ID> [--json]');
  process.exit(2);
}

const { dbMod, db } = openAppDb();
ensureHarnessMigration081(db);

const checks = runCodingSpinePostCallChecks(db, dbMod, sessionId, {
  provenanceExpected: 'spine or fallback',
  requireToolOrderInsuranceBeforeSchedule: true,
  requireAllowedAmount: true
});

const summary = summarizeChecks(checks, {
  session_id: sessionId,
  threshold: CODING_CONFIDENCE_THRESHOLD
});

printChecksAndExit(summary, { jsonOut });
