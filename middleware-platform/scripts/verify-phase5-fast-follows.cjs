#!/usr/bin/env node
'use strict';

/**
 * Phase 5 fast-follows gate (fd5-fast-follows, fd5-voice-p2 partial).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = path.join(ROOT, '..', 'unified-dashboard');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function main() {
  console.log('\n=== Phase 5 Fast-Follows Gate ===\n');
  let pass = true;

  const billing = fs.readFileSync(path.join(ROOT, 'services/billing-access.js'), 'utf8');
  pass = check('overflow forward TwiML helper', billing.includes('buildForwardOrBlockedTwiml')) && pass;
  pass = check('credits-exhausted overflow reasons', billing.includes('no_minutes')) && pass;

  const handler = fs.readFileSync(path.join(ROOT, 'services/voice-incoming-handler.js'), 'utf8');
  pass = check('concurrent overflow forward', handler.includes('overflowNumber') && handler.includes('buildForwardOrBlockedTwiml')) && pass;
  pass = check('billing block overflow forward', handler.includes('OVERFLOW_FORWARD_REASONS')) && pass;
  pass = check('overflow uses overflowNumber only (no transfer fallback)', !handler.includes('overflowNumber || runtime.transferNumber')) && pass;

  const turnResolver = fs.readFileSync(path.join(ROOT, 'services/kelly-turn-resolver.js'), 'utf8');
  pass = check('scriptOnly executes dispatch tools', turnResolver.includes('KellyToolExecutor.execute(tool.name')) && pass;

  const agentHtml = fs.readFileSync(path.join(UI, 'business/agent.html'), 'utf8');
  pass = check('getVaClinicId hoisted to IIFE scope', agentHtml.includes('let customer = null') && agentHtml.includes('function getVaClinicId()') && !agentHtml.includes('function getVaClinicId() {\n          return typeof window.ppGetClinicId')) && pass;

  const outbound = fs.readFileSync(
    path.join(ROOT, 'services/conversation-mode/rails/operator-outbound-rail.js'),
    'utf8'
  );
  pass = check('outbound appointment confirm', outbound.includes('appointment_confirmed') && outbound.includes('confirm_appointment')) && pass;

  const locale = fs.readFileSync(path.join(ROOT, 'services/kelly-rails/resolve-locale.js'), 'utf8');
  pass = check('language sticky locale', locale.includes('preferred_language')) && pass;

  const runtime = fs.readFileSync(path.join(ROOT, 'services/voice-agent-runtime.js'), 'utf8');
  pass = check('resolveOverflowNumber', runtime.includes('resolveOverflowNumber')) && pass;

  pass = check('migration 104', fs.existsSync(path.join(ROOT, 'migrations/104_phase5_voice_overflow.js'))) && pass;

  pass = check('overflow phone UI', agentHtml.includes('vaOverflowPhone')) && pass;
  pass = check('porting status UI', agentHtml.includes('vaPortingStatus')) && pass;
  pass = check('latency SLO KPI', agentHtml.includes('vaKpiLatency')) && pass;

  const today = fs.readFileSync(path.join(UI, 'business/today.html'), 'utf8');
  pass = check('ROI dashboard panel', today.includes('ppRoiPanel')) && pass;

  const settings = fs.readFileSync(path.join(UI, 'business/settings.html'), 'utf8');
  pass = check('team access panel', settings.includes('teamAccessPanel')) && pass;

  console.log('\n' + JSON.stringify({ pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
