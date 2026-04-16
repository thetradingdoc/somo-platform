'use strict';

/**
 * C2 — searchChunksAsync (vector stub merges; stub returns [] so matches FTS).
 * Run: node __tests__/retriever-vector-merge.test.js
 */

const Database = require('better-sqlite3');
const { up: m031 } = require('../migrations/031_user_sessions_and_knowledge_chunks');
const { createRetriever } = require('../services/retriever');

(async () => {
  const db = new Database(':memory:');
  m031(db);
  const r = createRetriever(db);
  if (typeof r.searchChunksAsync !== 'function') {
    console.error('searchChunksAsync missing');
    process.exit(1);
  }
  const out = await r.searchChunksAsync('retinol', 5);
  if (!Array.isArray(out) || out.length < 1) {
    console.error('expected FTS hits for retinol');
    process.exit(1);
  }
  console.log('retriever-vector-merge ok');
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
