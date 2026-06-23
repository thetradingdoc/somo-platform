#!/usr/bin/env node
'use strict';

/**
 * C3/C6 — Embed knowledge_chunks (split long text) and upsert to Pinecone.
 *
 * Requires: OPENAI_API_KEY, EMBEDDING_PROVIDER=openai, PINECONE_* , VECTOR_SEARCH_BACKEND=pinecone
 *
 *   node scripts/vector-sync-knowledge-chunks.cjs --db ./data.sqlite
 *
 * Env: VECTOR_SYNC_BATCH (default 16), VECTOR_SYNC_MAX_ROWS (0 = all)
 */

const path = require('path');
const Database = require('better-sqlite3');
const { splitTextForEmbedding } = require('../services/shared/text-chunking');
const { embedTexts, getEmbeddingRuntimeConfig } = require('../services/shared/embedding-provider');
const { pineconeUpsert, isPineconeConfigured } = require('../services/platform/pinecone-rest');
const { recordVectorSyncStats } = require('../services/shared/vector-index-ops');
const { up: m035 } = require('../database/migrations/035_knowledge_vector_index_meta');

function parseArgs() {
  const out = { db: null, maxRows: 0, batch: 16 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) out.db = argv[++i];
    else if (argv[i] === '--max-rows' && argv[i + 1]) out.maxRows = parseInt(argv[++i], 10) || 0;
    else if (argv[i] === '--batch' && argv[i + 1]) out.batch = Math.max(1, parseInt(argv[++i], 10) || 16);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  if (!args.db) {
    console.error('Usage: node scripts/vector-sync-knowledge-chunks.cjs --db <sqlite>');
    process.exit(1);
  }
  if (!isPineconeConfigured()) {
    console.error('Pinecone not configured (PINECONE_API_KEY + PINECONE_INDEX_HOST or PINECONE_INDEX_URL)');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY || String(process.env.EMBEDDING_PROVIDER || '').toLowerCase() !== 'openai') {
    console.error('Set EMBEDDING_PROVIDER=openai and OPENAI_API_KEY');
    process.exit(1);
  }

  const db = new Database(path.resolve(args.db));
  m035(db);

  let sql = 'SELECT id, text, ingredient_a, ingredient_b, product_id, sku, source FROM knowledge_chunks';
  if (args.maxRows > 0) sql += ` LIMIT ${args.maxRows}`;
  const rows = db.prepare(sql).all();
  const vectors = [];
  const cfg = getEmbeddingRuntimeConfig();

  for (const row of rows) {
    const pieces = splitTextForEmbedding(String(row.text || ''));
    const texts = pieces.length ? pieces : [String(row.id)];
    const embeddings = await embedTexts(texts);
    for (let i = 0; i < texts.length; i++) {
      const vec = embeddings[i];
      if (!vec) continue;
      const vid = `${row.id}::${i}`;
      vectors.push({
        id: vid,
        values: vec,
        metadata: {
          chunk_id: row.id,
          part: i,
          text: texts[i].slice(0, 3500),
          ingredient_a: row.ingredient_a || '',
          ingredient_b: row.ingredient_b || '',
          product_id: row.product_id || '',
          sku: row.sku || '',
          source: row.source || '',
        },
      });
    }
  }

  let upserted = 0;
  for (let i = 0; i < vectors.length; i += args.batch) {
    const chunk = vectors.slice(i, i + args.batch);
    const r = await pineconeUpsert(chunk);
    upserted += r.upserted || 0;
    console.log(`upserted ${upserted} / ${vectors.length}`);
  }

  recordVectorSyncStats(db, {
    rows_scanned: rows.length,
    vectors_upserted: upserted,
    embedding_model: cfg.modelId,
    dimensions: cfg.dimensions,
  });

  console.log('vector-sync-knowledge-chunks: done', upserted);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
