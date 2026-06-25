#!/usr/bin/env node
'use strict';

/**
 * Phase 1 live PSTN gate — pull DB, verify sessions, track operator progress.
 *
 * Usage:
 *   node scripts/phase1-operator-gate.cjs pull-db
 *   node scripts/phase1-operator-gate.cjs inventory
 *   node scripts/phase1-operator-gate.cjs checklist
 *   node scripts/phase1-operator-gate.cjs verify --world demo|tenant|unidentified|booking|t001 --session call_xxx
 *   node scripts/phase1-operator-gate.cjs probe-demo
 *   node scripts/phase1-operator-gate.cjs mark --step t001-ring --session call_xxx --notes "PSTN rang"
 *   node scripts/phase1-operator-gate.cjs status
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const defaultProd = path.join(ROOT, 'backups', 'middleware-staging.db');
const STATUS_PATH = path.join(__dirname, '..', 'var', 'evidence', 'phase1', 'OPERATOR_STATUS.json');
const PD4_LOG = path.join(ROOT, 'docs', 'deployment', 'PHASE1_PD4_LOG.md');

function loadStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (_) {
    return {
      revision: 'somo-middleware-00114-f69',
      image: 'gcr.io/somo-callsomo/somo-middleware:6cdfda9',
      steps: {}
    };
  }
}

function saveStatus(st) {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(st, null, 2) + '\n');
}

function markStep(step, data = {}) {
  const st = loadStatus();
  st.steps[step] = { ...data, at: new Date().toISOString() };
  saveStatus(st);
  console.log(`Marked: ${step}`);
}

function pullDb() {
  execSync(`bash "${path.join(ROOT, 'scripts', 'phase1-pull-prod-db.sh')}"`, {
    stdio: 'inherit',
    env: { ...process.env }
  });
  const dest = process.env.PHASE1_DB_PATH || path.join(ROOT, 'backups', 'middleware-staging.db');
  process.env.DB_PATH = dest;
  markStep('pull_db', { db_path: dest });
}

function verifyWorld(world, sessionId) {
  if (!sessionId) {
    console.error('--session call_xxx required');
    process.exit(2);
  }
  const mp = path.join(__dirname, '..');
  const dbPath = process.env.DB_PATH || path.join(ROOT, 'backups', 'middleware-staging.db');
  process.env.DB_PATH = dbPath;
  process.env.SESSION_ID = sessionId;

  let cmd;
  switch (world) {
    case 'demo':
      cmd = `node scripts/pd-4-platform-live-verify.cjs --session ${JSON.stringify(sessionId)}`;
      break;
    case 'tenant':
      cmd = `node scripts/voice-routing-matrix-live.cjs --tenant-book --session ${JSON.stringify(sessionId)}`;
      break;
    case 'unidentified':
    case 't001':
      cmd = `node scripts/voice-routing-matrix-live.cjs --fail-closed --session ${JSON.stringify(sessionId)}`;
      break;
    case 'booking':
      cmd = `node scripts/verify-live-booking-call.cjs --session ${JSON.stringify(sessionId)}`;
      break;
    default:
      console.error(`Unknown world: ${world}. Use demo|tenant|unidentified|booking|t001`);
      process.exit(2);
  }

  execSync(cmd, { cwd: mp, stdio: 'inherit', env: { ...process.env, DB_PATH: dbPath, SESSION_ID: sessionId } });
  markStep(`pd4_${world}`, { session_id: sessionId, pass: true });
  appendPd4Log(world, sessionId, true);
}

function appendPd4Log(world, sessionId, verified) {
  const line = `| ${world} | ${sessionId} | — | ${verified ? 'yes' : 'no'} | ${new Date().toISOString().slice(0, 10)} |\n`;
  if (!fs.existsSync(PD4_LOG)) {
    fs.writeFileSync(
      PD4_LOG,
      `# Phase 1 PD-4 log (revision 00114-f69)\n\n| World | call_id | routing_world | verified | date |\n|-------|---------|---------------|----------|------|\n`
    );
  }
  fs.appendFileSync(PD4_LOG, line);
}

function probeDemo() {
  const mp = path.join(__dirname, '..');
  const env = {
    ...process.env,
    PD4_PROBE_FROM_NUMBER: process.env.PD4_PROBE_FROM_NUMBER || '+12028131474'
  };
  execSync('node scripts/pd-4-platform-live-verify.cjs --probe-call', {
    cwd: mp,
    stdio: 'inherit',
    env
  });
  markStep('pd4_demo', { automated: true, pass: true });
}

function printStatus() {
  const st = loadStatus();
  console.log(JSON.stringify(st, null, 2));
  const required = [
    'pull_db',
    't001_call',
    't001_ring',
    't001_log',
    'pd4_demo',
    'pd4_tenant',
    'pd4_unidentified',
    'pd4_platform_support',
    'pd4_operator_outbound',
    'pd4_log',
    'booking_call',
    'booking_verify',
    'booking_portal'
  ];
  const missing = required.filter((k) => !st.steps[k]?.pass && !st.steps[k]?.at);
  if (missing.length) {
    console.log('\nPending operator steps:', missing.join(', '));
    process.exit(1);
  }
  console.log('\nPhase 1 exit gate: all tracked steps complete.');
}

function main() {
  if (fs.existsSync(defaultProd)) {
    process.env.DB_PATH = defaultProd;
  }
  const [cmd, ...rest] = process.argv.slice(2);
  const getArg = (flag) => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : null;
  };

  switch (cmd) {
    case 'pull-db':
      return pullDb();
    case 'inventory':
      return execSync('node scripts/phase1-did-inventory.cjs', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: process.env
      });
    case 'checklist':
      return execSync('node scripts/voice-routing-matrix-live.cjs --checklist', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
    case 'probe-demo':
      return probeDemo();
    case 'verify': {
      const world = getArg('--world');
      const session = getArg('--session');
      return verifyWorld(world, session);
    }
    case 'mark': {
      const step = getArg('--step');
      const session = getArg('--session');
      const notes = getArg('--notes') || '';
      if (!step) {
        console.error('Usage: mark --step <id> [--session call_xxx] [--notes text]');
        process.exit(2);
      }
      return markStep(step, { pass: true, session_id: session, notes });
    }
    case 'status':
      return printStatus();
    default:
      console.log(`Usage:
  node scripts/phase1-operator-gate.cjs pull-db
  node scripts/phase1-operator-gate.cjs inventory
  node scripts/phase1-operator-gate.cjs checklist
  node scripts/phase1-operator-gate.cjs probe-demo
  node scripts/phase1-operator-gate.cjs verify --world demo --session call_xxx
  node scripts/phase1-operator-gate.cjs mark --step t001-ring --session call_xxx
  node scripts/phase1-operator-gate.cjs status`);
      process.exit(cmd ? 1 : 0);
  }
}

main();
