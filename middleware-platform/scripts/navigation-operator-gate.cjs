#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const STATUS_PATH = path.join(__dirname, '..', 'var', 'evidence', 'navigation', 'OPERATOR_STATUS.json');

const VERIFY_SCRIPTS = {
  routing: 'navigation-routing-live.cjs',
  resolve: 'navigation-resolve-plan-live.cjs',
  benefits: 'navigation-benefits-live.cjs',
  find: 'navigation-find-care-live.cjs',
  pitch: 'navigation-pitch-e2e-live.cjs',
  slots: 'navigation-slots-live.cjs',
  book: 'navigation-book-live.cjs',
  copay: 'navigation-copay-live.cjs',
  checkout: 'navigation-checkout-live.cjs',
  bookpay: 'navigation-book-pay-live.cjs',
  in_network: 'navigation-in-network-live.cjs',
  employer: 'navigation-employer-live.cjs',
  quality: 'navigation-conversation-quality-live.cjs',
  prod: 'navigation-member-acceptance-prod.cjs'
};

function loadStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (_) {
    return { revision: 'navigation-p1-p5', steps: {} };
  }
}

function saveStatus(st) {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(st, null, 2) + '\n');
}

function printChecklist() {
  console.log(`
Navigation operator checklist
===========================
P0  npm run navigation:seed && npm run navigation:preflight && npm run test:navigation:contracts
D1  npm run navigation:gcs-seed
P1  navigation:routing-live | resolve-plan-live | benefits-live | find-care-live | pitch-e2e-live
P2  navigation:slots-live | book-live | copay-live | checkout-live | book-pay-live
P3  navigation:in-network-live
P4  navigation:employer-live
P5  navigation:conversation-quality-live | navigation:member-acceptance-prod
    npm run navigation:acceptance
`);
}

function verifyWorld(world, sessionId) {
  if (!sessionId) {
    console.error('--session call_xxx required');
    process.exit(2);
  }
  const script = VERIFY_SCRIPTS[world];
  if (!script) {
    console.error(`Unknown world: ${world}`);
    process.exit(2);
  }
  const scriptPath = path.join(__dirname, script);
  const r = spawnSync(process.execPath, [scriptPath, '--session', sessionId], {
    stdio: 'inherit',
    env: process.env
  });
  process.exit(r.status ?? 1);
}

function markStep(step, data = {}) {
  const st = loadStatus();
  st.steps[step] = { ...data, at: new Date().toISOString() };
  saveStatus(st);
  console.log(`Marked: ${step}`);
}

function main() {
  const cmd = process.argv[2];
  const sessionIdx = process.argv.indexOf('--session');
  const sessionId = sessionIdx >= 0 ? process.argv[sessionIdx + 1] : null;
  const stepIdx = process.argv.indexOf('--step');
  const step = stepIdx >= 0 ? process.argv[stepIdx + 1] : null;
  const notesIdx = process.argv.indexOf('--notes');
  const notes = notesIdx >= 0 ? process.argv[notesIdx + 1] : null;

  switch (cmd) {
    case 'checklist':
      printChecklist();
      break;
    case 'verify': {
      const worldIdx = process.argv.indexOf('--world');
      const world = worldIdx >= 0 ? process.argv[worldIdx + 1] : null;
      if (!world) {
        console.error('--world required');
        process.exit(2);
      }
      verifyWorld(world, sessionId);
      break;
    }
    case 'mark':
      if (!step) {
        console.error('--step required');
        process.exit(2);
      }
      markStep(step, { notes, session: sessionId || null });
      break;
    case 'status':
      console.log(JSON.stringify(loadStatus(), null, 2));
      break;
    default:
      console.error('Usage: checklist | verify --world X --session call_xxx | mark --step X | status');
      process.exit(2);
  }
}

main();
