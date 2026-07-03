#!/usr/bin/env node
'use strict';

/**
 * Configure pilot clinic for Dentrix PMS (Phase 3B).
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

  const clientId = process.env.DENTRIX_CLIENT_ID;
  const clientSecret = process.env.DENTRIX_CLIENT_SECRET;
  const organizationId = process.env.DENTRIX_ORGANIZATION_ID;

  if (!clientId || !clientSecret) {
    throw new Error('DENTRIX_CLIENT_ID and DENTRIX_CLIENT_SECRET required — run: npm run setup:henry-schein-application');
  }
  if (!organizationId) {
    throw new Error('DENTRIX_ORGANIZATION_ID required — run: npm run discover:dentrix-sandbox');
  }

  console.log(`\n=== Phase 3B Dentrix setup: ${clinic.name} (${clinicId}) ===\n`);

  db.updateClinic(clinicId, {
    pms_type: 'dentrix',
    pms_enabled: 1,
    pms_config: encryptPmsConfig({
      client_id: clientId,
      client_secret: clientSecret,
      organization_id: organizationId,
      location_id: process.env.DENTRIX_LOCATION_ID || null,
      operatory_id: process.env.DENTRIX_OPERATORY_ID || null,
      default_appointment_type_id: process.env.DENTRIX_DEFAULT_APPOINTMENT_TYPE_ID || null,
      environment: process.env.DENTRIX_ENVIRONMENT || 'sandbox',
      mirror_google: false
    }),
    pms_connected_at: new Date().toISOString(),
    pms_last_error: null
  });

  console.log('✅ pms_type=dentrix, pms_enabled=1');
  console.log(`✅ organization_id=${organizationId} location_id=${process.env.DENTRIX_LOCATION_ID || '(unset)'}`);
  console.log('✅ Run: npm run verify:phase3-dentrix\n');
}

main();
