#!/usr/bin/env node
'use strict';

/**
 * Phase 1 A1 — assert canonical DB path and codebook counts.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const MP = path.join(__dirname, '..', '..');
const CANONICAL = path.join(MP, 'var/db/middleware-dev.db');
const LEGACY = path.join(MP, 'middleware-dev.db');
const ARCHIVE_DIR = path.join(MP, 'var/db/archive');

process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';

const db = require('../../database').db;

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

const report = {
  app_db_path: db.name || process.env.DB_PATH,
  canonical_path: CANONICAL,
  legacy_db_exists: legacyExists,
  legacy_db_at_root: legacyAtRoot,
  legacy_archived: legacyArchived,
  icd10_count: icd,
  cpt_count: cpt,
  hcpcs_count: hcpcs,
  embeddings_count: emb,
  embed_coverage: Number(embedCoverage.toFixed(4)),
  em_codes_missing: emMissing,
  all_ok:
    String(db.name || '').includes('var/db/middleware-dev.db')
    && icd >= 70000
    && cpt >= 15000
    && hcpcs >= 8000
    && embedCoverage >= 0.95
    && emMissing.length === 0
    && !legacyAtRoot
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.all_ok ? 0 : 2);
