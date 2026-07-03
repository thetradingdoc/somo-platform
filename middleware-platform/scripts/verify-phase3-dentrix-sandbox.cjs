#!/usr/bin/env node
'use strict';

/**
 * Phase 3B Dentrix sandbox gate — health + schedule sample.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { spawnSync } = require('child_process');
const { PmsHub, clearContextCache } = require('../services/pms/pms-hub');

const CLINIC =
  process.env.PHASE3_PILOT_CLINIC_ID ||
  process.env.PHASE2_PILOT_CLINIC_ID ||
  'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

async function main() {
  if (!process.env.DENTRIX_CLIENT_ID || !process.env.DENTRIX_CLIENT_SECRET) {
    console.log('⚠️  Skipping Dentrix sandbox — DENTRIX_CLIENT_ID not set');
    console.log('   Run: npm run setup:henry-schein-application');
    process.exit(0);
  }

  process.chdir(path.join(__dirname, '..'));
  const db = require('../database');
  const mig = require('../migrations/099_phase3_pms_connect');
  if (mig?.up && db.db) mig.up(db.db);

  if (process.env.SKIP_DENTRIX_SETUP !== '1') {
    const setup = spawnSync('node', ['scripts/setup-phase3-dentrix-pilot.cjs'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: process.env
    });
    if (setup.status !== 0) process.exit(setup.status || 1);
  }

  clearContextCache();
  const hub = PmsHub.tryForClinic(CLINIC);
  if (!hub) {
    console.error('❌ PMS hub not available for clinic', CLINIC);
    process.exit(1);
  }

  const health = await hub.healthCheck();
  console.log('Health:', health);
  if (!health.ok) {
    console.error('❌ Dentrix health check failed');
    process.exit(1);
  }

  const future = new Date();
  future.setDate(future.getDate() + 30);
  while (future.getDay() === 0 || future.getDay() === 6) future.setDate(future.getDate() + 1);
  const date = future.toISOString().slice(0, 10);

  const schedule = await hub.getSchedule({
    date,
    appointment_type: 'General Consult',
    timezone: 'America/New_York'
  });
  console.log(`✅ Open slots on ${date}:`, (schedule.available_slots || schedule.slots || []).slice(0, 5));
  console.log('\n✅ Dentrix sandbox gate OK\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
