#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    triage: path.join(__dirname, '..', 'tmp', 'unknown-tag-backlog.triage.csv'),
    output: path.join(__dirname, '..', 'tmp', 'unknown-ambiguous-clusters.csv'),
    top: 200
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--triage') out.triage = String(argv[++i] || out.triage);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
    else if (a === '--top') out.top = Math.max(10, Number(argv[++i] || out.top) || out.top);
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

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (!/[,"\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function main() {
  const args = parseArgs(process.argv);
  const lines = fs.readFileSync(args.triage, 'utf8').trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const idx = (k) => header.indexOf(k);
  const rows = [];
  for (const line of lines.slice(1)) {
    const r = parseCsvLine(line);
    if (String(r[idx('triage_class')] || '') !== 'manual_review') continue;
    rows.push({
      rank: Number(r[idx('rank')] || 0),
      tag: String(r[idx('tag')] || ''),
      count: Number(r[idx('count')] || 0),
      sample_code: String(r[idx('sample_code')] || ''),
      sample_product_name: String(r[idx('sample_product_name')] || ''),
      owner: String(r[idx('owner')] || 'catalog-data-ops'),
      status: 'queued_review'
    });
  }
  rows.sort((a, b) => b.count - a.count || a.rank - b.rank);
  const top = rows.slice(0, args.top);
  const outLines = ['rank,tag,count,sample_code,sample_product_name,owner,status'];
  for (const r of top) {
    outLines.push(
      [r.rank, r.tag, r.count, r.sample_code, r.sample_product_name, r.owner, r.status].map(csvEscape).join(',')
    );
  }
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${outLines.join('\n')}\n`, 'utf8');
  console.log(`[ambiguous-cluster-export] wrote ${args.output} rows=${top.length}`);
}

main();
