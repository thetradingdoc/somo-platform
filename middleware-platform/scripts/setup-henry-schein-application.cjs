#!/usr/bin/env node
'use strict';

/**
 * Henry Schein API Exchange application checklist (Phase 3B — Dentrix Ascend).
 *
 * Usage:
 *   node scripts/setup-henry-schein-application.cjs
 *   node scripts/setup-henry-schein-application.cjs --open
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');

const APPLY_URL = 'https://www.henryscheinone.com/dental-solutions/api-exchange/';
const DOCS_URL = 'https://papidocs.hs1api.com/publicapi/api-consumer-guide';

function main() {
  const open = process.argv.includes('--open');
  console.log('\n=== Henry Schein API Exchange (Dentrix Ascend) ===\n');
  console.log('Ordered steps (fd3-henry-schein, fd3-dentrix, fd3-dentrix-e2e-sandbox):\n');
  const steps = [
    '1. Apply for API Exchange vendor access',
    '2. Sign Henry Schein integration agreement + receive sandbox client_id/client_secret',
    '3. Add to middleware-platform/.env: DENTRIX_CLIENT_ID, DENTRIX_CLIENT_SECRET',
    '4. Run: npm run discover:dentrix-sandbox — sets DENTRIX_ORGANIZATION_ID + DENTRIX_LOCATION_ID',
    '5. Run: npm run setup:phase3-dentrix-pilot — binds pilot clinic pms_type=dentrix',
    '6. Run: npm run verify:phase3-dentrix — sandbox health + schedule smoke',
    '7. Run: npm run verify:phase3-sandbox — combined book + eligibility + copay journey'
  ];
  for (const s of steps) console.log(`   ${s}`);

  console.log('\n── References ──\n');
  console.log(`   Apply: ${APPLY_URL}`);
  console.log(`   API guide: ${DOCS_URL}`);
  console.log(`   Internal doc: docs/voice-agent/phase3-dentrix-setup.md`);

  const hasId = Boolean((process.env.DENTRIX_CLIENT_ID || '').trim());
  const hasSecret = Boolean((process.env.DENTRIX_CLIENT_SECRET || '').trim());
  const appSubmitted = ['1', 'true', 'yes'].includes(
    String(process.env.HENRY_SCHEIN_APPLICATION_SUBMITTED || '').trim().toLowerCase()
  );
  console.log('\n── Local env ──\n');
  console.log(`DENTRIX_CLIENT_ID: ${hasId ? 'set ✅' : 'missing ⚠️'}`);
  console.log(`DENTRIX_CLIENT_SECRET: ${hasSecret ? 'set ✅' : 'missing ⚠️'}`);
  console.log(`DENTRIX_ORGANIZATION_ID: ${process.env.DENTRIX_ORGANIZATION_ID || '(unset)'}`);
  console.log(
    `HENRY_SCHEIN_APPLICATION_SUBMITTED: ${appSubmitted ? '1 ✅ [fd3-henry-schein]' : 'unset ⚠️ — set after Legal submits application'}`
  );

  if (open && process.platform === 'darwin') {
    spawnSync('open', [APPLY_URL], { stdio: 'inherit' });
  }
  console.log('');
}

main();
