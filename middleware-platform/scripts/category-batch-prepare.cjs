#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    triage: path.join(__dirname, '..', 'tmp', 'unknown-tag-backlog.triage.csv'),
    batchId: `batch_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    limit: 50,
    output: path.join(__dirname, '..', 'tmp', 'category-batch-candidate.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--triage') out.triage = String(argv[++i] || out.triage);
    else if (a === '--batch-id') out.batchId = String(argv[++i] || out.batchId);
    else if (a === '--limit') out.limit = Math.max(1, Number(argv[++i] || out.limit) || out.limit);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
  }
  return out;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
      continue;
    }
    if (c === ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const lines = fs.readFileSync(args.triage, 'utf8').trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const idx = (k) => header.indexOf(k);
  const picks = [];
  for (const line of lines.slice(1)) {
    const r = parseCsvLine(line);
    if (r[idx('triage_class')] !== 'real_category') continue;
    if ((r[idx('status')] || '').toLowerCase() !== 'approved') continue;
    const batch = r[idx('batch_id')] || '';
    if (batch && batch !== args.batchId) continue;
    const tag = r[idx('tag')] || '';
    const route = r[idx('proposed_route')] || '';
    if (!tag || !route) continue;
    picks.push({ tag, route, owner: r[idx('owner')] || '', notes: r[idx('notes')] || '' });
    if (picks.length >= args.limit) break;
  }
  const out = {
    batch_id: args.batchId,
    generated_at: new Date().toISOString(),
    limit: args.limit,
    candidates: picks
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`[category-batch-prepare] wrote ${args.output} candidates=${picks.length}`);
}

main();
