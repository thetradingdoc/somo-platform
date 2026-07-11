#!/usr/bin/env node
'use strict';

/**
 * Appendix B — append one K-02 nightly eval result to the tracking log.
 *
 * Usage (after eval:coding:prod):
 *   node scripts/update-k02-nightly-log.cjs --pass --rate 72 --failures "gen-fill-150"
 *   node scripts/update-k02-nightly-log.cjs --fail --rate 54
 */

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../var/evidence/k02-nightly-log.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { pass: null, rate: null, failures: '', action: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pass') out.pass = true;
    if (args[i] === '--fail') out.pass = false;
    if (args[i] === '--rate') out.rate = parseInt(args[++i], 10);
    if (args[i] === '--failures') out.failures = args[++i] || '';
    if (args[i] === '--action') out.action = args[++i] || '';
  }
  return out;
}

function main() {
  const cli = parseArgs();
  if (cli.pass === null) {
    console.error('Usage: update-k02-nightly-log.cjs --pass|--fail --rate N [--failures text]');
    process.exit(2);
  }

  const log = fs.existsSync(LOG_PATH)
    ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
    : { version: 1, nights: [], consecutive_green: 0, target: 7 };

  const date = new Date().toISOString().slice(0, 10);
  const entry = {
    night: log.nights.length + 1,
    date,
    result: cli.pass ? 'pass' : 'fail',
    pass_rate_pct: cli.rate,
    notable_failures: cli.failures,
    action_taken: cli.action || (cli.pass ? 'none' : 'reset count')
  };

  if (!cli.pass) {
    log.consecutive_green = 0;
    log.status = 'reset';
  } else {
    log.consecutive_green = (log.consecutive_green || 0) + 1;
    log.status = log.consecutive_green >= 7 ? 'complete' : 'in_progress';
  }

  if (!log.started_at) log.started_at = new Date().toISOString();
  log.nights.push(entry);
  log.last_updated = new Date().toISOString();
  log.cp05_prerequisite = 'met 2026-07-11';

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  console.log(JSON.stringify({
    ok: true,
    consecutive_green: log.consecutive_green,
    status: log.status,
    path: LOG_PATH
  }, null, 2));
}

main();
