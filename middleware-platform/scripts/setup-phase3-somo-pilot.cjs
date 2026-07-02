#!/usr/bin/env node
'use strict';

/**
 * Configure Somo pilot for Phase 3 PMS (somo adapter).
 * Usage: node scripts/setup-phase3-somo-pilot.cjs [--clinic-id <id>]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');

const SOMO_CLINIC_ID = 'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

function argClinicId() {
  const idx = process.argv.indexOf('--clinic-id');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.PHASE3_PILOT_CLINIC_ID || process.env.PHASE2_PILOT_CLINIC_ID || SOMO_CLINIC_ID;
}

function main() {
  process.chdir(path.join(__dirname, '..'));
  const db = require('../database');
  const { encryptPmsConfig } = require('../services/pms/pms-config');
  const mig = require('../migrations/099_phase3_pms_connect');
  if (mig?.up && db.db) mig.up(db.db);

  const clinicId = argClinicId();
  const clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

  console.log(`\n=== Phase 3 PMS setup: ${clinic.name} (${clinicId}) ===\n`);

  db.updateClinic(clinicId, {
    pms_type: 'somo',
    pms_enabled: 1,
    pms_config: encryptPmsConfig({ mirror_google: true }),
    pms_connected_at: new Date().toISOString(),
    pms_last_error: null
  });

  console.log('✅ pms_type=somo, pms_enabled=1');
  console.log('✅ Run: npm run verify:phase3-sandbox\n');
}

main();
