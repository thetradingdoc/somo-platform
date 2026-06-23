#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Audit = require('../../services/platform/semantic-reject-audit-service');

function parseArgs(argv) {
  const out = { limit: 500, sessionId: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--limit=')) out.limit = Number(arg.split('=')[1] || '500');
    if (arg.startsWith('--session=')) out.sessionId = String(arg.split('=')[1] || '').trim() || null;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const rows = Audit.listSemanticRejects({ limit: args.limit, sessionId: args.sessionId });
  const outDir = path.join(__dirname, '..', 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `semantic-reject-audit-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), count: rows.length, rows }, null, 2));
  console.log(`[semantic-reject-audit] exported ${rows.length} row(s) to ${outPath}`);
}

main();
