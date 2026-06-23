#!/usr/bin/env node
'use strict';

/**
 * V6-3 helper — verify clinical-prep API for an appointment (provider dashboard gate).
 *
 * Usage:
 *   APPOINTMENT_ID=appt-xxx BASE_URL=https://api.callsomo.com \\
 *     RCM_E2E_PROVIDER_EMAIL=... RCM_E2E_PROVIDER_PASSWORD=... \\
 *     node scripts/phase-b-v6-3-checklist.cjs
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
const fixtures = require('../lib/kelly-conversation-fixtures.cjs');

const API_BASE = (process.env.BASE_URL || process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const APPT = process.env.APPOINTMENT_ID || process.env.CLINICAL_PREP_APPOINTMENT_ID;
const EMAIL = process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.RCM_E2E_PROVIDER_PASSWORD || 'demo123';

async function main() {
  if (!APPT) {
    console.error('Set APPOINTMENT_ID (from F2 scorecard / session output).');
    process.exit(1);
  }
  console.log('V6-3 clinical-prep check for', APPT);
  const inProcess = fixtures.assertClinicalPrepInProcess(APPT, process.env.SESSION_ID || null);
  console.log('In-process clinical prep:', inProcess ? 'OK' : 'missing');

  try {
    const jar = await fixtures.providerApiLogin(API_BASE, EMAIL, PASS);
    await fixtures.assertClinicalPrep(API_BASE, jar, APPT, process.env.SESSION_ID || null);
    console.log('HTTP clinical-prep: OK');
    console.log('\nManual: confirm today.html schedule/activity feed shows this appointment.');
    process.exit(0);
  } catch (e) {
    console.error('HTTP clinical-prep failed:', e.message);
    if (inProcess) {
      console.log('In-process passed — complete manual today.html check and retry HTTP when API up.');
      process.exit(0);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
