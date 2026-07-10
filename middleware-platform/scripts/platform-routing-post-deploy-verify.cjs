#!/usr/bin/env node
'use strict';

/**
 * Post-deploy checklist for platform routing (363 → platform_support).
 *
 * Usage:
 *   node scripts/platform-routing-post-deploy-verify.cjs
 *   node scripts/platform-routing-post-deploy-verify.cjs --session call_xxx
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const { execSync } = require('child_process');
const { isPlatformInboundSupportMode } = require('../services/platform-line-config');

function main() {
  console.log('=== Platform routing post-deploy verify ===\n');

  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  push('PLATFORM_INBOUND_MODE=support', isPlatformInboundSupportMode(), process.env.PLATFORM_INBOUND_MODE || '(default support)');
  push('NAVIGATION_ENABLED=0', process.env.NAVIGATION_ENABLED === '0' || !process.env.NAVIGATION_ENABLED, process.env.NAVIGATION_ENABLED || '0/unset');
  push(
    'CALLSOMO_OPERATOR_FALLBACK_PSTN set',
    !!process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN,
    process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN ? '(set)' : '(missing — handoff will fail)'
  );
  push(
    'CALLSOMO_OPERATOR_CUSTOMER_ID set',
    !!process.env.CALLSOMO_OPERATOR_CUSTOMER_ID,
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID || '(missing)'
  );

  console.log('1) Run operator Twilio sync:');
  console.log('   node scripts/callsomo-operator-sync.cjs\n');
  console.log('2) Place inbound PSTN call to +13639990205');
  console.log('3) Confirm routing_world_resolved = platform_support in logs\n');

  const sessionArg = process.argv.find((a) => a.startsWith('--session='))?.split('=')[1]
    || (process.argv.indexOf('--session') >= 0 ? process.argv[process.argv.indexOf('--session') + 1] : null);

  if (sessionArg) {
    console.log(`4) Retell verify: --world platform_support --session ${sessionArg}\n`);
    try {
      execSync(`node scripts/phase1-retell-verify.cjs --world platform_support --session ${sessionArg}`, {
        stdio: 'inherit'
      });
      push('phase1-retell-verify platform_support', true, sessionArg);
    } catch {
      push('phase1-retell-verify platform_support', false, sessionArg);
    }
  }

  for (const c of checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\n✅ Pre-flight checks passed — complete live PSTN step manually if not done');
}

main();
