#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { PmsHub } = require('../services/pms/pms-hub');

const CLINIC =
  process.env.PHASE3_PILOT_CLINIC_ID ||
  process.env.PHASE2_PILOT_CLINIC_ID ||
  'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

async function main() {
  process.chdir(path.join(__dirname, '..'));
  const hub = PmsHub.tryForClinic(CLINIC);
  if (!hub) {
    console.error('❌ PMS hub not available for clinic', CLINIC);
    process.exit(1);
  }
  const ctx = await hub.getPatientContext({ caller_phone: '+15555550100', call_id: 'verify-phase3' });
  const health = await hub.healthCheck();
  console.log('health:', health);
  console.log('context:', { success: ctx.success, degraded: ctx.degraded, has_patient: !!ctx.patient });
  if (!health.ok) {
    console.error('❌ health check failed');
    process.exit(1);
  }
  console.log('✅ Phase 3 context pull OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
