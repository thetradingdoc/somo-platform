#!/usr/bin/env node
'use strict';

/**
 * Phase 1 A1 — assert canonical DB path and codebook counts.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const CANONICAL = path.resolve(__dirname, '..', 'var/db/middleware-dev.db');
const LEGACY = path.resolve(__dirname, '..', 'middleware-dev.db');
const ARCHIVE_DIR = path.resolve(__dirname, '..', 'var/db/archive');

process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';

const db = require('../database').db;

function count(sql) {
  return db.prepare(sql).get()?.n ?? 0;
}

const icd = count('SELECT COUNT(*) AS n FROM icd10_codes');
const cpt = count('SELECT COUNT(*) AS n FROM cpt_codes');
const hcpcs = count('SELECT COUNT(*) AS n FROM hcpcs_codes');
const emb = count('SELECT COUNT(*) AS n FROM code_embeddings');
const codeRows = icd + cpt + hcpcs;
const embedCoverage = codeRows ? emb / codeRows : 0;

const emCodes = ['99202', '99203', '99204', '99205', '99211', '99212', '99213', '99214', '99215'];
const emMissing = emCodes.filter((c) => {
  const row = db.prepare('SELECT 1 FROM cpt_codes WHERE code = ? LIMIT 1').get(c);
  return !row;
});

const legacyExists = fs.existsSync(LEGACY);
const legacyArchived = legacyExists && LEGACY.startsWith(ARCHIVE_DIR);

const legacyAtRoot = legacyExists && path.resolve(LEGACY) === LEGACY && !legacyArchived;

const dbName = String(db.name || process.env.DB_PATH || '');
const isProdSnapshot = dbName.includes('middleware-prod');
const pathOk = dbName.includes('var/db/middleware-dev') || dbName.includes('var/db/middleware-prod');
const countsOk = icd >= 70000 && cpt >= 15000 && hcpcs >= 8000;
const embedOk = isProdSnapshot ? embedCoverage >= 0.95 : true;

const report = {
  app_db_path: db.name || process.env.DB_PATH,
  canonical_path: isProdSnapshot
    ? path.resolve(__dirname, '..', 'var/db/middleware-prod.db')
    : CANONICAL,
  legacy_db_exists: legacyExists,
  legacy_db_at_root: legacyAtRoot,
  legacy_archived: legacyArchived,
  icd10_count: icd,
  cpt_count: cpt,
  hcpcs_count: hcpcs,
  embeddings_count: emb,
  embed_coverage: Number(embedCoverage.toFixed(4)),
  em_codes_missing: emMissing,
  prod_snapshot: isProdSnapshot,
  all_ok:
    pathOk
    && countsOk
    && embedOk
    && emMissing.length === 0
    && !legacyAtRoot
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.all_ok ? 0 : 2);
