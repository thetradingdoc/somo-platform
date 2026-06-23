#!/usr/bin/env node
'use strict';

/**
 * Document and check SQLITE_BUSY / GCS SQLite contention signals.
 *
 * Reads SQLITE_BUSY_TIMEOUT_MS env and optionally scans log files for SQLITE_BUSY patterns.
 *
 * Usage:
 *   node scripts/verify/verify-gcs-sqlite-contention.cjs
 *   LOG_PATH=/var/log/app.log SQLITE_BUSY_MAX=5 node scripts/verify/verify-gcs-sqlite-contention.cjs
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const logPath = process.env.LOG_PATH || process.env.CLOUDRUN_LOG_PATH || '';
const maxBusy = parseInt(process.env.SQLITE_BUSY_MAX || '10', 10);
const busyTimeoutMs = parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '60000', 10);
const gcsBucket = process.env.GCS_DB_BUCKET || '';

function scanLogForBusy(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { scanned: false, count: 0, samples: [] };
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => /SQLITE_BUSY|database is locked/i.test(l));
  return {
    scanned: true,
    count: lines.length,
    samples: lines.slice(0, 5)
  };
}

function main() {
  const logScan = scanLogForBusy(logPath);
  const recommendations = [
    'Ensure GCS_DB_BUCKET is set for durable Cloud Run SQLite (cloudrun-db-sync.cjs).',
    'Raise SQLITE_BUSY_TIMEOUT_MS under concurrent read/write (default 60000ms in database.js).',
    'Avoid long-running writers during deploy; use SKIP_STARTUP_MIGRATIONS=1 for read-only verify scripts.',
    'Upload only via cloudrun-db-sync upload after operator preflight (see shouldBlockUpload).'
  ];

  const report = {
    gcs_db_bucket: gcsBucket || null,
    sqlite_busy_timeout_ms: busyTimeoutMs,
    log_path: logPath || null,
    log_scan: logScan,
    recommendations,
    pass: !logScan.scanned || logScan.count <= maxBusy
  };

  if (logScan.scanned && logScan.count > maxBusy) {
    report.violation = `SQLITE_BUSY occurrences (${logScan.count}) exceed max (${maxBusy})`;
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
