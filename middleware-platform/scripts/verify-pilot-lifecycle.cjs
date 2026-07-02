#!/usr/bin/env node
'use strict';

/**
 * Pilot lifecycle structural gate — phase4 + optional clinic shadow/live path.
 *
 * Usage:
 *   node scripts/verify-pilot-lifecycle.cjs
 *   node scripts/verify-pilot-lifecycle.cjs --clinic-id <id>
 *   node scripts/verify-pilot-lifecycle.cjs --clinic-id <id> --go-live
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

function run(script, args = []) {
  const r = spawnSync('node', [script, ...args], { cwd: ROOT, stdio: 'inherit', env: process.env });
  return r.status === 0;
}

function main() {
  const clinicId = process.argv.includes('--clinic-id')
    ? process.argv[process.argv.indexOf('--clinic-id') + 1]
    : null;
  const goLive = process.argv.includes('--go-live');

  console.log('\n=== Verify pilot lifecycle ===\n');

  let pass = run('scripts/verify-phase4-pilot.cjs');
  if (!pass) process.exit(1);

  if (goLive && clinicId) {
    console.log('\n── setup:pilot-live ──\n');
    pass = run('scripts/setup-pilot-live.cjs', ['--clinic-id', clinicId]) && pass;
  }

  if (clinicId) {
    console.log('\n── clinic shadow / live flags ──\n');
    process.chdir(ROOT);
    const db = require('../database');
    const clinic = db.db?.prepare('SELECT shadow_week_active, pilot_live_at FROM clinics WHERE clinic_id = ?').get(clinicId);
    if (!clinic) {
      console.error(`❌ clinic not found: ${clinicId}`);
      process.exit(1);
    }
    if (goLive) {
      if (!clinic.pilot_live_at) {
        console.error('❌ pilot_live_at not set after go-live');
        pass = false;
      } else {
        console.log(`✅ pilot_live_at=${clinic.pilot_live_at}`);
      }
    } else {
      console.log(`shadow_week_active=${clinic.shadow_week_active}, pilot_live_at=${clinic.pilot_live_at || '(unset)'}`);
    }

    console.log('\n── copay desk parity (informational) ──\n');
    run('scripts/verify-pilot-copay-desk-parity.cjs', ['--clinic-id', clinicId]);
  }

  console.log('\n── Irreducible office actions (go-live week) ──\n');
  console.log('  • Forward practice main line to Kelly Twilio number');
  console.log('  • Place real PSTN test call; confirm branded opener');
  console.log('  • Run shadow week on live patient volume');
  console.log(`  Docs: ${path.join(REPO, 'docs/voice-agent/phase4-pilot-checklist.md')}\n`);

  process.exit(pass ? 0 : 1);
}

main();
