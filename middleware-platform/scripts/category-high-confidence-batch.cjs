#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    triage: path.join(__dirname, '..', 'tmp', 'unknown-tag-backlog.triage.csv'),
    batchId: 'batch_003',
    output: path.join(__dirname, '..', 'tmp', 'category-batch-003-candidate.json'),
    minCount: 20,
    limit: 30
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--triage') out.triage = String(argv[++i] || out.triage);
    else if (a === '--batch-id') out.batchId = String(argv[++i] || out.batchId);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
    else if (a === '--min-count') out.minCount = Math.max(1, Number(argv[++i] || out.minCount) || out.minCount);
    else if (a === '--limit') out.limit = Math.max(1, Number(argv[++i] || out.limit) || out.limit);
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
  const candidates = [];
  for (const line of lines.slice(1)) {
    const r = parseCsvLine(line);
    const triageClass = String(r[idx('triage_class')] || '');
    const status = String(r[idx('status')] || '').toLowerCase();
    const route = String(r[idx('proposed_route')] || '').trim();
    const tag = String(r[idx('tag')] || '').trim().toLowerCase();
    const owner = String(r[idx('owner')] || 'catalog-data-ops');
    const count = Number(r[idx('count')] || 0);
    if (triageClass !== 'real_category') continue;
    if (status !== 'approved') continue;
    if (!tag || !route) continue;
    if (count < args.minCount) continue;
    candidates.push({
      tag,
      route,
      owner,
      notes: `high_confidence_auto batch=${args.batchId} count>=${args.minCount}`
    });
    if (candidates.length >= args.limit) break;
  }
  const out = {
    batch_id: args.batchId,
    generated_at: new Date().toISOString(),
    gate: { min_count: args.minCount, limit: args.limit },
    candidates
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`[high-confidence-batch] wrote ${args.output} candidates=${candidates.length}`);
}

main();
