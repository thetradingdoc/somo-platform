#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    output: path.join(__dirname, '..', 'tmp', 'category-slice-evidence.csv'),
    sliceId: '',
    tagsDelta: '',
    aliasesDelta: '',
    heuristicRuleIds: '',
    unknownDelta: '',
    routeShiftDelta: '',
    guardStatus: 'unknown'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--output') out.output = String(argv[++i] || out.output);
    else if (a === '--slice-id') out.sliceId = String(argv[++i] || '');
    else if (a === '--tags-delta') out.tagsDelta = String(argv[++i] || '');
    else if (a === '--aliases-delta') out.aliasesDelta = String(argv[++i] || '');
    else if (a === '--heuristic-rule-ids') out.heuristicRuleIds = String(argv[++i] || '');
    else if (a === '--unknown-delta') out.unknownDelta = String(argv[++i] || '');
    else if (a === '--route-shift-delta') out.routeShiftDelta = String(argv[++i] || '');
    else if (a === '--guard-status') out.guardStatus = String(argv[++i] || out.guardStatus);
  }
  return out;
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (!/[,"\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.sliceId) {
    console.error('missing required --slice-id');
    process.exit(1);
  }
  const header =
    'recorded_at,slice_id,tags_delta,aliases_delta,heuristic_rule_ids,unknown_delta,route_shift_delta,guard_status';
  const line = [
    new Date().toISOString(),
    args.sliceId,
    args.tagsDelta,
    args.aliasesDelta,
    args.heuristicRuleIds,
    args.unknownDelta,
    args.routeShiftDelta,
    args.guardStatus
  ]
    .map(csvEscape)
    .join(',');
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  if (!fs.existsSync(args.output)) fs.writeFileSync(args.output, `${header}\n`, 'utf8');
  fs.appendFileSync(args.output, `${line}\n`, 'utf8');
  console.log(`[category-slice-evidence] appended ${args.output}`);
}

main();
