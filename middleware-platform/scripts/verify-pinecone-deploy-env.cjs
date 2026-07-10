#!/usr/bin/env node
'use strict';

/** D-01: Confirm Pinecone + RAG env for deploy. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const required = ['PINECONE_API_KEY', 'PINECONE_INDEX_HOST'];
const optional = ['PINECONE_MIN_SCORE', 'PINECONE_FALLBACK_MIN_SCORE', 'EMBEDDING_MODEL', 'EMBEDDING_DIM'];
const checks = [];
for (const k of required) {
  checks.push({ name: k, pass: !!process.env[k], value: process.env[k] ? 'set' : 'missing' });
}
const ragDisabled = process.env.RAG_API_URL === 'disabled' || process.env.RAG_API_URL === '';
checks.push({
  name: 'RAG_API_URL',
  pass: process.env.RAG_API_URL === 'disabled',
  value: process.env.RAG_API_URL || '(unset — must be disabled)'
});
for (const k of optional) {
  checks.push({ name: k, pass: true, value: process.env[k] || 'default' });
}
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ checks, success: failed.length === 0 }, null, 2));
process.exit(failed.length ? 2 : 0);
