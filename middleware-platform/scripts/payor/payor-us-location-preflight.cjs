#!/usr/bin/env node
'use strict';

/**
 * Preflight checks for US location/payor ingest pipeline.
 *
 * Prints:
 * - resolved DB path (+ optional running API DB path when available)
 * - source file existence / size / sha256
 * - schema + index audit for core tables
 * - row counts before ingest
 *
 * Usage:
 *   DB_PATH=./middleware-dev.db node scripts/payor/payor-us-location-preflight.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REQUIRED = {
  CROSSWALK_FILE: process.env.CROSSWALK_FILE || '',
  SERVICE_AREA_CSV: process.env.SERVICE_AREA_CSV || '',
  LANDSCAPE_CSV: process.env.LANDSCAPE_CSV || '',
  PBP_DIR: process.env.PBP_DIR || ''
};

function resolveDbPath() {
  const p = String(process.env.DB_PATH || '').trim();
  if (!p) throw new Error('DB_PATH is required');
  return path.resolve(p);
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function fileMeta(filePath, expectDir = false) {
  const abs = path.resolve(String(filePath || ''));
  const exists = fs.existsSync(abs);
  if (!exists) return { path: abs, exists: false };
  const stat = fs.statSync(abs);
  if (expectDir && !stat.isDirectory()) {
    return { path: abs, exists: true, type: 'file', error: 'expected_directory' };
  }
  if (!expectDir && !stat.isFile()) {
    return { path: abs, exists: true, type: 'directory', error: 'expected_file' };
  }
  const out = { path: abs, exists: true, bytes: stat.size, mtime: stat.mtime.toISOString() };
  if (!expectDir) out.sha256 = sha256File(abs);
  return out;
}

function runSqliteQuery(dbPath, sql) {
  const py = `
import sqlite3, json
con = sqlite3.connect(r'''${dbPath}''')
con.row_factory = sqlite3.Row
cur = con.cursor()
rows = cur.execute(r'''${sql}''').fetchall()
print(json.dumps([dict(r) for r in rows]))
con.close()
`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'sqlite query failed');
  return JSON.parse((r.stdout || '[]').trim() || '[]');
}

function fetchRunningApiDbPath() {
  const r = spawnSync('curl', ['-s', 'http://127.0.0.1:4000/health?show_db_path=1'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try {
    const payload = JSON.parse(String(r.stdout || '{}'));
    return payload.database_path || payload.db_path || null;
  } catch (_) {
    return null;
  }
}

function tableAudit(dbPath, tableName) {
  const schema = runSqliteQuery(dbPath, `PRAGMA table_info(${tableName})`);
  const indexes = runSqliteQuery(dbPath, `PRAGMA index_list(${tableName})`);
  const countRows = runSqliteQuery(dbPath, `SELECT COUNT(*) AS count FROM ${tableName}`);
  return {
    table: tableName,
    columns: schema.map((c) => c.name),
    indexes: indexes.map((i) => i.name),
    row_count: Number(countRows?.[0]?.count || 0)
  };
}

function main() {
  const dbPath = resolveDbPath();
  const runningApiDbPath = fetchRunningApiDbPath();
  const payload = {
    event: 'payor_us_location_preflight',
    db_path: dbPath,
    api_running_db_path: runningApiDbPath,
    db_path_match_api: runningApiDbPath ? path.resolve(runningApiDbPath) === dbPath : null,
    source_files: {
      CROSSWALK_FILE: fileMeta(REQUIRED.CROSSWALK_FILE),
      SERVICE_AREA_CSV: fileMeta(REQUIRED.SERVICE_AREA_CSV),
      LANDSCAPE_CSV: fileMeta(REQUIRED.LANDSCAPE_CSV),
      PBP_DIR: fileMeta(REQUIRED.PBP_DIR, true)
    },
    schema_audit: [
      tableAudit(dbPath, 'zip_county_crosswalk'),
      tableAudit(dbPath, 'payor_plan_service_areas'),
      tableAudit(dbPath, 'payor_plan_premiums'),
      tableAudit(dbPath, 'payor_plan_benefits')
    ]
  };

  const pbpDir = payload.source_files.PBP_DIR;
  if (pbpDir.exists && !pbpDir.error) {
    const files = fs.readdirSync(pbpDir.path).filter((f) => /^pbp_.*\.txt$/i.test(f));
    payload.source_files.PBP_DIR.pbp_txt_count = files.length;
  }

  const missing = Object.entries(payload.source_files)
    .filter(([, v]) => !v.exists || v.error)
    .map(([k, v]) => ({ key: k, detail: v }));

  payload.failures = [];
  if (runningApiDbPath && payload.db_path_match_api === false) {
    payload.failures.push('db_path_mismatch_with_running_api');
  }
  if (missing.length) payload.failures.push('missing_or_invalid_source_files');
  payload.missing_details = missing;

  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.failures.length ? 1 : 0);
}

main();
