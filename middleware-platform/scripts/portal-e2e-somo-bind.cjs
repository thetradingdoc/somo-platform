#!/usr/bin/env node
'use strict';

/**
 * Re-bind tenant DID to Somo customer_id + operator-sync + did-verify.
 *
 * Usage:
 *   PORTAL_E2E_SOMO_CUSTOMER_ID=cust_xxx node scripts/portal-e2e-somo-bind.cjs
 */

const path = require('path');
const { execSync } = require('child_process');
const { saveState } = require('../e2e/helpers/portal-e2e-create-state.cjs');

const ROOT = path.join(__dirname, '..', '..');
const MP = path.join(__dirname, '..');
const TENANT_DID = process.env.PORTAL_E2E_TENANT_DID || '+18623622415';

function log(msg) {
  console.log(`[somo-bind] ${msg}`);
}

function main() {
  const customerId = process.env.PORTAL_E2E_SOMO_CUSTOMER_ID;
  if (!customerId) {
    console.error('Set PORTAL_E2E_SOMO_CUSTOMER_ID');
    process.exit(2);
  }

  log(`binding ${TENANT_DID} → ${customerId}`);
  saveState({ state: 'did_bind_pending', customer_id: customerId }, 'DID bind starting');

  const env = {
    ...process.env,
    CALLSOMO_VOICE_CUSTOMER_ID: customerId,
    CAPSTONE_CUSTOMER_ID: customerId,
    PORTAL_E2E_TWILIO_PHONE_SID: process.env.PORTAL_E2E_TWILIO_PHONE_SID || 'PN2bd21643839fd34e8c9a58a05d716b05',
    MIDDLEWARE_API_BASE: process.env.MIDDLEWARE_API_BASE || 'https://api.callsomo.com',
    DEPLOY_INTENT: 'production'
  };

  execSync(`node "${path.join(ROOT, 'scripts', 'callsomo-operator-sync.cjs')}"`, {
    cwd: ROOT,
    env,
    stdio: 'inherit'
  });

  execSync(`node "${path.join(MP, 'scripts', 'portal-e2e-did-verify.cjs')}"`, {
    cwd: MP,
    env: {
      ...env,
      PORTAL_E2E_SOMO_CUSTOMER_ID: customerId,
      MIDDLEWARE_API_BASE: env.MIDDLEWARE_API_BASE
    },
    stdio: 'inherit'
  });

  saveState({ state: 'complete', customer_id: customerId }, 'DID verified');
  log('=== Somo bind complete ===');
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  main();
}
