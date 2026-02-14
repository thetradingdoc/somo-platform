#!/usr/bin/env node
/**
 * Populate code_embeddings table for semantic search (Phase 2.3 - optional).
 * Requires OPENAI_API_KEY. Run after ICD-10/CPT/HCPCS imports.
 * Usage: node scripts/populate-code-embeddings.js [--limit N] [--type icd10|cpt|hcpcs]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const db = require('../database');
const { embedText } = require('../services/semantic-search-service');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY required. Set in .env to enable semantic search.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 100 : null;
  const typeIdx = args.indexOf('--type');
  const typeFilter = typeIdx >= 0 ? args[typeIdx + 1] : null;
  const incremental = args.includes('--incremental');
  const backfillSpecialty = args.includes('--backfill-specialty');

  if (backfillSpecialty) {
    const result = db.backfillCodeEmbeddingSpecialty?.();
    if (result) {
      console.log(`✅ Backfilled specialty for ${result.updated} code_embeddings rows`);
      if (result.reason) console.log(`   (${result.reason})`);
    } else {
      console.log('⚠️  backfillCodeEmbeddingSpecialty not available');
    }
    if (args.length === 1) return;
  }

  let total = 0;

  if (!typeFilter || typeFilter === 'icd10') {
    const sql = incremental
      ? `SELECT c.code, c.description FROM icd10_codes c
         LEFT JOIN code_embeddings e ON e.code = c.code AND e.code_type = 'icd10'
         WHERE e.code IS NULL LIMIT ?`
      : 'SELECT code, description FROM icd10_codes LIMIT ?';
    const rows = db.prepare(sql).all(limit || 5000);
    console.log(`Embedding ${rows.length} ICD-10 codes...`);
    for (const r of rows) {
      const text = `${r.code} ${r.description}`.slice(0, 8000);
      const emb = await embedText(text);
      if (emb) {
        db.upsertCodeEmbedding({
          code: r.code,
          code_type: 'icd10',
          description_text: r.description,
          embedding_json: JSON.stringify(emb)
        });
        total++;
      }
      if (total % 100 === 0 && total > 0) console.log(`  ${total} done...`);
    }
  }

  if (!typeFilter || typeFilter === 'cpt') {
    const sql = incremental
      ? `SELECT c.code, c.description FROM cpt_codes c
         LEFT JOIN code_embeddings e ON e.code = c.code AND e.code_type = 'cpt'
         WHERE e.code IS NULL LIMIT ?`
      : 'SELECT code, description FROM cpt_codes LIMIT ?';
    const rows = db.prepare(sql).all(limit || 2000);
    console.log(`Embedding ${rows.length} CPT codes...`);
    for (const r of rows) {
      const text = `${r.code} ${r.description}`.slice(0, 8000);
      const emb = await embedText(text);
      if (emb) {
        db.upsertCodeEmbedding({
          code: r.code,
          code_type: 'cpt',
          description_text: r.description,
          embedding_json: JSON.stringify(emb)
        });
        total++;
      }
    }
  }

  if (!typeFilter || typeFilter === 'hcpcs') {
    const sql = incremental
      ? `SELECT c.code, c.long_desc FROM hcpcs_codes c
         LEFT JOIN code_embeddings e ON e.code = c.code AND e.code_type = 'hcpcs'
         WHERE e.code IS NULL LIMIT ?`
      : 'SELECT code, long_desc FROM hcpcs_codes LIMIT ?';
    const rows = db.prepare(sql).all(limit || 2000);
    console.log(`Embedding ${rows.length} HCPCS codes...`);
    for (const r of rows) {
      const text = `${r.code} ${r.long_desc}`.slice(0, 8000);
      const emb = await embedText(text);
      if (emb) {
        db.upsertCodeEmbedding({
          code: r.code,
          code_type: 'hcpcs',
          description_text: r.long_desc,
          embedding_json: JSON.stringify(emb)
        });
        total++;
      }
    }
  }

  console.log(`✅ Populated ${total} code embeddings`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
