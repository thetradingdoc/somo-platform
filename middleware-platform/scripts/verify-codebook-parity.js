#!/usr/bin/env node
'use strict';

/**
 * Session 2 — codebook parity verifier.
 * Usage: DB_PATH=./var/db/middleware-dev.db node scripts/verify-codebook-parity.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const db = require('../database').db;

const MIN_ICD = parseInt(process.env.MIN_ICD10_CODES || '70000', 10);
const MIN_CPT = parseInt(process.env.MIN_CPT_CODES || '15000', 10);
const MIN_HCPCS = parseInt(process.env.MIN_HCPCS_CODES || '8000', 10);
const MIN_PCS = parseInt(process.env.MIN_ICD10_PCS_CODES || '75000', 10);
const MIN_POS = parseInt(process.env.MIN_POS_CODES || '50', 10);
const MIN_MODIFIERS = parseInt(process.env.MIN_MODIFIER_CODES || '40', 10);
const EMBED_TOLERANCE = parseFloat(process.env.CODEBOOK_EMBED_TOLERANCE || '0.05', 10);

function count(sql) {
  try {
    return db.prepare(sql).get()?.n ?? 0;
  } catch (_) {
    return 0;
  }
}

function describe(code, type) {
  const row = db.prepare(`
    SELECT description FROM ${type === 'cpt' ? 'cpt_codes' : 'icd10_codes'}
    WHERE REPLACE(code, '.', '') = REPLACE(?, '.', '') LIMIT 1
  `).get(code);
  return row?.description || null;
}

const icd = count('SELECT COUNT(*) AS n FROM icd10_codes');
const cpt = count('SELECT COUNT(*) AS n FROM cpt_codes');
const hcpcs = count('SELECT COUNT(*) AS n FROM hcpcs_codes');
const pcs = count('SELECT COUNT(*) AS n FROM icd10_pcs_codes');
const pos = count('SELECT COUNT(*) AS n FROM place_of_service_codes');
const modifiers = count('SELECT COUNT(*) AS n FROM modifier_codes');
const emb = count('SELECT COUNT(*) AS n FROM code_embeddings');
const spineCodeRows = icd + cpt + hcpcs;
const embedCoverage = spineCodeRows ? emb / spineCodeRows : 0;
const skipEmbedCheck = process.env.SKIP_EMBED_CHECK === '1';
const embedOk = skipEmbedCheck ? true : (spineCodeRows === 0 ? false : embedCoverage >= 1 - EMBED_TOLERANCE);

const emCodes = ['99202', '99203', '99204', '99205', '99211', '99212', '99213', '99214', '99215'];
const emMissing = emCodes.filter((c) => !describe(c, 'cpt'));

const report = {
  db_path: db.name || process.env.DB_PATH,
  icd10: { count: icd, ok: icd >= MIN_ICD, min: MIN_ICD },
  cpt: { count: cpt, ok: cpt >= MIN_CPT, min: MIN_CPT },
  hcpcs: { count: hcpcs, ok: hcpcs >= MIN_HCPCS, min: MIN_HCPCS },
  icd10_pcs: { count: pcs, ok: pcs >= MIN_PCS, min: MIN_PCS, loaded: pcs > 0 },
  place_of_service: { count: pos, ok: pos >= MIN_POS, min: MIN_POS },
  modifiers: { count: modifiers, ok: modifiers >= MIN_MODIFIERS, min: MIN_MODIFIERS },
  embeddings: {
    count: emb,
    spine_code_rows: spineCodeRows,
    coverage_ratio: Number(embedCoverage.toFixed(4)),
    ok: embedOk,
    skipped: skipEmbedCheck,
    tolerance: EMBED_TOLERANCE,
    note: 'PCS embeddings optional — run populate-code-embeddings --type icd10_pcs separately'
  },
  em_codes: { checked: emCodes.length, missing: emMissing, ok: emMissing.length === 0 }
};

console.log(JSON.stringify(report, null, 2));

const ok =
  report.icd10.ok &&
  report.cpt.ok &&
  report.hcpcs.ok &&
  report.icd10_pcs.ok &&
  report.place_of_service.ok &&
  report.modifiers.ok &&
  report.embeddings.ok &&
  report.em_codes.ok;

process.exit(ok ? 0 : 1);
