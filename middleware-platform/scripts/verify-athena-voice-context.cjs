#!/usr/bin/env node
'use strict';

/**
 * Voice-path smoke: PmsHub.getPatientContext on Athena pilot clinic.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PmsHub, clearContextCache } = require('../services/pms/pms-hub');

const CLINIC =
  process.env.PHASE3_PILOT_CLINIC_ID ||
  process.env.PHASE2_PILOT_CLINIC_ID ||
  'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

async function main() {
  if (!process.env.ATHENA_CLIENT_ID) {
    console.log('⚠️  Skipping Athena voice smoke — no creds');
    process.exit(0);
  }

  clearContextCache();
  const hub = PmsHub.tryForClinic(CLINIC);
  if (!hub || hub.pmsType !== 'athena') {
    console.error('❌ Pilot clinic not on Athena — run npm run setup:phase3-athena');
    process.exit(1);
  }

  const ctx = await hub.getPatientContext({
    caller_phone: process.env.ATHENA_TEST_PHONE || '+15555550100',
    call_id: `voice-smoke-${Date.now()}`
  });

  console.log('Patient context:', {
    degraded: ctx.degraded,
    patient: ctx.patient?.full_name || ctx.patient?.id || null,
    next_appointment: ctx.next_appointment,
    pms_type: ctx.pms_type
  });

  console.log('✅ Athena voice context smoke complete (degraded OK when phone unknown)');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
