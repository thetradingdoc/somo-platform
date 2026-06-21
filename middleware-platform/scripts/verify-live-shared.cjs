#!/usr/bin/env node
'use strict';

/**
 * Shared helpers for production live-call acceptance scripts.
 */

const { bootstrapVerifyEnv, canonicalDbPath } = require('./lib/verify-env.cjs');
const { parseVerifyArgs, requireSessionId } = require('./lib/verify-args.cjs');
const { parseJson } = require('./lib/verify-assert.cjs');
const {
  resolveDbPath,
  openReadonlyDb,
  fetchKellyEventsRaw,
  findToolCompleted,
  findEventType
} = require('./lib/verify-db.cjs');

bootstrapVerifyEnv({ skipMigrations: true });

function printReportAndExit(report) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

module.exports = {
  parseArgs: parseVerifyArgs,
  parseVerifyArgs,
  resolveDbPath,
  canonicalDbPath,
  openReadonlyDb,
  parsePayload: parseJson,
  fetchKellyEvents: fetchKellyEventsRaw,
  findToolCompleted,
  findEventType,
  requireSessionId,
  printReportAndExit
};
