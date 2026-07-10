#!/usr/bin/env node
/**
 * Backfill specialty column for existing code_embeddings (Layer 2).
 * No API keys required - derives specialty from code prefix (S*=ortho, I*=cardio, etc.).
 * Usage: node scripts/backfill-code-embeddings-specialty.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const dbModule = require('../database');

function main() {
  const backfill = dbModule.backfillCodeEmbeddingSpecialty;
  if (typeof backfill !== 'function') {
    console.error('❌ backfillCodeEmbeddingSpecialty not found in database module.');
    process.exit(1);
  }
  const result = backfill();
  console.log(`✅ Backfilled specialty for ${result.updated} code embeddings`);
  if (result.message) console.log(`   ${result.message}`);
}

main();
