#!/usr/bin/env node
/**
 * Verify medical + dental codebook row counts against production parity targets.
 * Usage: DATABASE_PATH=/path/to.db npm run verify:prod-codebook
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const db = require('../database').db;
const { cdtQualityFromDb } = require('./lib/cdt-description-quality.cjs');

const MIN_ICD = parseInt(process.env.MIN_ICD10_CODES || '70000', 10);
const MIN_CPT = parseInt(process.env.MIN_CPT_CODES || '15000', 10);
const MIN_CPT_EMB = parseInt(process.env.MIN_CPT_EMBEDDINGS || '15000', 10);
const MIN_HCPCS = parseInt(process.env.MIN_HCPCS_CODES || '8000', 10);
const MIN_CDT = parseInt(process.env.MIN_CDT_CODES || '800', 10);
const MIN_CDT_QUALITY = parseFloat(process.env.MIN_CDT_QUALITY || '0.8');
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EXPECTED_EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '1536', 10);
const MIN_PINECONE_VECTORS = parseInt(process.env.MIN_PINECONE_VECTORS || '1000', 10);

function count(sql) {
  try {
    return db.prepare(sql).get()?.n ?? 0;
  } catch (_) {
    return 0;
  }
}

const icd = count('SELECT COUNT(*) AS n FROM icd10_codes');
const cpt = count('SELECT COUNT(*) AS n FROM cpt_codes');
const hcpcs = count('SELECT COUNT(*) AS n FROM hcpcs_codes');
const cdt = count('SELECT COUNT(*) AS n FROM cdt_codes');
const cptEmb = count("SELECT COUNT(*) AS n FROM code_embeddings WHERE code_type='cpt'");
const emb = count('SELECT COUNT(*) AS n FROM code_embeddings');
const mpfs = count('SELECT COUNT(*) AS n FROM fee_schedules');
const cdtQuality = cdtQualityFromDb(db);
const cdtQualityRounded = Number(cdtQuality.quality_ratio.toFixed(4));

console.log('Codebook counts:');
console.log('  icd10_codes:', icd, icd >= MIN_ICD ? 'OK' : `FAIL (need >= ${MIN_ICD})`);
console.log('  cpt_codes:', cpt, cpt >= MIN_CPT ? 'OK' : `FAIL (need >= ${MIN_CPT})`);
console.log('  hcpcs_codes:', hcpcs, hcpcs >= MIN_HCPCS ? 'OK' : `FAIL (need >= ${MIN_HCPCS})`);
console.log('  cdt_codes:', cdt, cdt >= MIN_CDT ? 'OK' : `FAIL (need >= ${MIN_CDT})`);
console.log(
  '  cdt quality:',
  `${cdtQuality.non_placeholder}/${cdtQuality.total} (${cdtQualityRounded})`,
  cdtQualityRounded >= MIN_CDT_QUALITY ? 'OK' : `FAIL (need >= ${MIN_CDT_QUALITY})`
);
console.log('  cpt embeddings:', cptEmb, cptEmb >= MIN_CPT_EMB ? 'OK' : `FAIL (need >= ${MIN_CPT_EMB})`);
console.log('  code_embeddings total:', emb);
console.log('  fee_schedules:', mpfs);
console.log('  embedding_model:', EMBEDDING_MODEL, process.env.EMBEDDING_MODEL ? 'OK' : 'WARN (default)');
console.log('  embedding_dim:', EXPECTED_EMBEDDING_DIM);

let pineconeOk = true;
if (process.env.PINECONE_DEPLOY_GATE === '1') {
  pineconeOk = !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_HOST);
  console.log(
    '  pinecone_deploy_gate:',
    pineconeOk ? 'OK' : 'FAIL (PINECONE_API_KEY + PINECONE_INDEX_HOST required)'
  );
} else {
  console.log('  pinecone_deploy_gate:', 'SKIP (set PINECONE_DEPLOY_GATE=1 on deploy)');
}

const ok =
  icd >= MIN_ICD &&
  cpt >= MIN_CPT &&
  hcpcs >= MIN_HCPCS &&
  cdt >= MIN_CDT &&
  cdtQualityRounded >= MIN_CDT_QUALITY &&
  cptEmb >= MIN_CPT_EMB &&
  pineconeOk;
process.exit(ok ? 0 : 1);
