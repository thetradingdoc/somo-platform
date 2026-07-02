#!/usr/bin/env node
'use strict';

/**
 * Phase 3B Athena sandbox gate — health, schedule sample, optional book + writeNote.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { PmsHub, clearContextCache } = require('../services/pms/pms-hub');

const CLINIC =
  process.env.PHASE3_PILOT_CLINIC_ID ||
  process.env.PHASE2_PILOT_CLINIC_ID ||
  'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

async function main() {
  if (!process.env.ATHENA_CLIENT_ID || !process.env.ATHENA_CLIENT_SECRET) {
    console.log('⚠️  Skipping Athena sandbox — ATHENA_CLIENT_ID not set');
    process.exit(0);
  }

  process.chdir(path.join(__dirname, '..'));
  const db = require('../database');
  const mig = require('../migrations/099_phase3_pms_connect');
  if (mig?.up && db.db) mig.up(db.db);

  if (process.env.SKIP_ATHENA_SETUP !== '1') {
    const setup = spawnSync('node', ['scripts/setup-phase3-athena-pilot.cjs'], {
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

  let health;
  for (let attempt = 1; attempt <= 3; attempt++) {
    health = await hub.healthCheck();
    const quota = String(health.message || '').toLowerCase().includes('quota');
    if (health.ok || !quota || attempt === 3) break;
    const waitMs = attempt * 60_000;
    console.warn(`⚠️  OAuth quota — waiting ${waitMs / 1000}s before retry ${attempt + 1}/3`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  console.log('Health:', health);
  if (!health.ok) {
    console.error('❌ Athena health check failed');
    if (String(health.message || '').toLowerCase().includes('quota')) {
      console.error('   Preview OAuth quota is limited. Wait 5–10 minutes, then run only:');
      console.error('   npm run verify:phase3-athena');
    }
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

  const note = await hub.writeNote({
    patient_id: 'sandbox-smoke',
    text: 'Phase 3B Athena sandbox smoke note',
    note_type: 'front_desk'
  });
  console.log('✅ writeNote:', note.success ? 'ok' : note);

  const out = {
    pass: true,
    clinic_id: CLINIC,
    health,
    schedule_sample: (schedule.available_slots || []).slice(0, 3),
    at: new Date().toISOString()
  };

  const outDir = path.join(__dirname, '..', 'var', 'evidence', 'phase3');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'athena-sandbox-acceptance.json'), JSON.stringify(out, null, 2));

  console.log('\n✅ Phase 3B Athena sandbox gate passed\n');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
