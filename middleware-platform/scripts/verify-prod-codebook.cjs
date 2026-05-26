#!/usr/bin/env node
/**
 * Verify medical codebook row counts against production parity targets.
 * Usage: DATABASE_PATH=/path/to.db npm run verify:prod-codebook
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const db = require('../database').db;

const MIN_CPT = parseInt(process.env.MIN_CPT_CODES || '15000', 10);
const MIN_CPT_EMB = parseInt(process.env.MIN_CPT_EMBEDDINGS || '15000', 10);

function count(sql) {
  return db.prepare(sql).get()?.n ?? 0;
}

const cpt = count('SELECT COUNT(*) AS n FROM cpt_codes');
const cptEmb = count("SELECT COUNT(*) AS n FROM code_embeddings WHERE code_type='cpt'");
const icd = count('SELECT COUNT(*) AS n FROM icd10_codes');
const emb = count('SELECT COUNT(*) AS n FROM code_embeddings');
const mpfs = count('SELECT COUNT(*) AS n FROM fee_schedules');

console.log('Codebook counts:');
console.log('  icd10_codes:', icd);
console.log('  cpt_codes:', cpt, cpt >= MIN_CPT ? 'OK' : `FAIL (need >= ${MIN_CPT})`);
console.log('  cpt embeddings:', cptEmb, cptEmb >= MIN_CPT_EMB ? 'OK' : `FAIL (need >= ${MIN_CPT_EMB})`);
console.log('  code_embeddings total:', emb);
console.log('  fee_schedules:', mpfs);

const ok = cpt >= MIN_CPT && cptEmb >= MIN_CPT_EMB;
process.exit(ok ? 0 : 1);
