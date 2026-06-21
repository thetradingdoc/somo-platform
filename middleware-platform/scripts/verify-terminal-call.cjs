#!/usr/bin/env node
'use strict';

/**
 * Session 4 post-call verifier (terminal or live).
 * Usage: node scripts/verify-terminal-call.cjs --session_id=<ID> [--scenario=copay_due|fully_covered|cannot_determine] [--json]
 */

const { bootstrapVerifyEnv } = require('./lib/verify-env.cjs');
bootstrapVerifyEnv();

const { parseVerifyArgs } = require('./lib/verify-args.cjs');
const { summarizeChecks, printChecksAndExit } = require('./lib/verify-assert.cjs');
const { openAppDb } = require('./lib/verify-db.cjs');
const { ensureHarnessMigration081 } = require('./lib/verify-migrations.cjs');
const { runCodingSpinePostCallChecks, CODING_CONFIDENCE_THRESHOLD } = require('./lib/coding-spine-checks.cjs');

const { sessionId, scenario, jsonOut } = parseVerifyArgs();
if (!sessionId) {
  console.error('Usage: node scripts/verify-terminal-call.cjs --session_id=<ID> [--scenario=...] [--json]');
  process.exit(2);
}

const { dbMod, db } = openAppDb();
ensureHarnessMigration081(db);

const checks = runCodingSpinePostCallChecks(db, dbMod, sessionId, {
  scenario,
  provenanceExpected: 'spine'
});

const summary = summarizeChecks(checks, {
  session_id: sessionId,
  scenario: scenario || null,
  threshold: CODING_CONFIDENCE_THRESHOLD
});

printChecksAndExit(summary, { jsonOut });
