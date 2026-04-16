#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    input: path.join(__dirname, '..', 'tmp', 'unknown-tag-backlog.top500.csv'),
    output: path.join(__dirname, '..', 'tmp', 'unknown-tag-backlog.triage.csv')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--input') out.input = String(argv[++i] || out.input);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const rows = fs.readFileSync(args.input, 'utf8').trim().split('\n');
  const header = rows[0];
  const triageHeader = `${header},triage_class,proposed_action,proposed_route,owner,status,batch_id,notes`;
  const out = [triageHeader];
  for (const line of rows.slice(1)) {
    out.push(`${line},,,,,pending,,`);
  }
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${out.join('\n')}\n`, 'utf8');
  console.log(`[backlog-triage-template] wrote ${args.output} rows=${out.length - 1}`);
}

main();
