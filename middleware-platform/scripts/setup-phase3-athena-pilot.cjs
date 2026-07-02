#!/usr/bin/env node
'use strict';

/**
 * Configure pilot clinic for Athena PMS (Phase 3B).
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

  const clientId = process.env.ATHENA_CLIENT_ID;
  const clientSecret = process.env.ATHENA_CLIENT_SECRET;
  const practiceId = process.env.ATHENA_PRACTICE_ID;
  const departmentId = process.env.ATHENA_DEPARTMENT_ID;

  if (!clientId || !clientSecret) {
    throw new Error('ATHENA_CLIENT_ID and ATHENA_CLIENT_SECRET required in .env');
  }
  if (!practiceId) {
    throw new Error('ATHENA_PRACTICE_ID required — run: node scripts/discover-athena-sandbox-ids.cjs');
  }

  console.log(`\n=== Phase 3B Athena setup: ${clinic.name} (${clinicId}) ===\n`);

  db.updateClinic(clinicId, {
    pms_type: 'athena',
    pms_enabled: 1,
    pms_config: encryptPmsConfig({
      client_id: clientId,
      client_secret: clientSecret,
      practice_id: practiceId,
      department_id: departmentId || null,
      default_appointmenttype_id: process.env.ATHENA_DEFAULT_APPOINTMENTTYPE_ID || null,
      api_base: process.env.ATHENA_API_BASE || 'https://api.preview.platform.athenahealth.com',
      mirror_google: false
    }),
    pms_connected_at: new Date().toISOString(),
    pms_last_error: null
  });

  console.log('✅ pms_type=athena, pms_enabled=1');
  console.log(`✅ practice_id=${practiceId} department_id=${departmentId || '(unset)'}`);
  console.log('✅ Run: npm run verify:phase3-athena\n');
}

main();
