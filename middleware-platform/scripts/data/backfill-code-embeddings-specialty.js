#!/usr/bin/env node
/**
 * Backfill specialty column for existing code_embeddings (Layer 2).
 * No API keys required - derives specialty from code prefix (S*=ortho, I*=cardio, etc.).
 * Usage: node scripts/data/backfill-code-embeddings-specialty.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../../database');

function main() {
  if (typeof db.backfillCodeEmbeddingsSpecialty !== 'function') {
    console.error('❌ backfillCodeEmbeddingsSpecialty not found in database module.');
    process.exit(1);
  }
  const result = db.backfillCodeEmbeddingsSpecialty();
  console.log(`✅ Backfilled specialty for ${result.updated} code embeddings`);
  if (result.message) console.log(`   ${result.message}`);
}

main();
