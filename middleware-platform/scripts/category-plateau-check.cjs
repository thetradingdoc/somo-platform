#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    history: path.join(__dirname, '..', 'tmp', 'category-batch-metrics-history.json'),
    minUnknownDropAbs: 0.005,
    consecutiveBatches: 2
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--history') out.history = String(argv[++i] || out.history);
    else if (a === '--min-unknown-drop-abs') out.minUnknownDropAbs = Number(argv[++i] || out.minUnknownDropAbs);
    else if (a === '--consecutive') out.consecutiveBatches = Math.max(1, Number(argv[++i] || out.consecutiveBatches) || out.consecutiveBatches);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const hist = JSON.parse(fs.readFileSync(args.history, 'utf8'));
  const entries = Array.isArray(hist) ? hist : [];
  const recent = entries.slice(-args.consecutiveBatches);
  if (recent.length < args.consecutiveBatches) {
    console.log('[category-plateau-check] insufficient_history');
    return;
  }
  const weak = recent.every((x) => Number(x.unknown_drop_abs || 0) < args.minUnknownDropAbs);
  const out = {
    min_unknown_drop_abs: args.minUnknownDropAbs,
    consecutive_batches: args.consecutiveBatches,
    recent_batches: recent,
    plateau: weak
  };
  console.log(JSON.stringify(out, null, 2));
  if (weak) {
    console.error('[category-plateau-check] PLATEAU detected');
    process.exitCode = 2;
  } else {
    console.log('[category-plateau-check] PASS');
  }
}

main();
