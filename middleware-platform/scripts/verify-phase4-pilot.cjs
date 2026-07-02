#!/usr/bin/env node
'use strict';

/**
 * Phase 4 pilot gate — invite flow, clinic PATCH, rate limits, frontend wiring.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = path.join(ROOT, '..', 'unified-dashboard');

function fail(report, msg) {
  report.checks.push({ ok: false, message: msg });
  report.pass = false;
}

function pass(report, msg) {
  report.checks.push({ ok: true, message: msg });
}

function main() {
  const report = { pass: true, checks: [] };
  const required = [
    'migrations/103_phase4_pilot.js',
    'services/provider-invite-service.js',
    'services/pilot-config.js',
    'routes/provider-invites.js',
    'routes/public-pilot-config.js',
    'routes/tenant-clinic.js',
    'middleware/pilot-rate-limit.js',
    'services/internal-events.js',
    'services/log-redaction.js',
    'services/disposition-taxonomy.js',
    'services/loop-telemetry.js',
    '../unified-dashboard/business/invite.html',
    '../unified-dashboard/assets/js/settings/tab-practice.js',
    '../docs/voice-agent/phase4-pilot-checklist.md'
  ];
  for (const f of required) {
    if (fs.existsSync(path.join(ROOT, f))) pass(report, `exists: ${f}`);
    else fail(report, `missing: ${f}`);
  }
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  if (server.includes('/api/invites')) pass(report, 'invite API wired');
  else fail(report, 'invite API missing');
  if (server.includes('publicPilotConfigRoutes')) pass(report, 'pilot config API wired');
  else fail(report, 'pilot config API missing');
  if (server.includes('isPilotInviteOnly')) pass(report, 'PILOT_INVITE_ONLY signup gate');
  else fail(report, 'signup gate missing');
  if (server.includes('/api/tenant/clinic')) pass(report, 'clinic PATCH API wired');
  else fail(report, 'clinic API missing');
  const invites = fs.readFileSync(path.join(ROOT, 'routes/provider-invites.js'), 'utf8');
  if (invites.includes('requireAdminOrCapability')) pass(report, 'admin invite auth');
  else fail(report, 'admin invite auth missing');
  if (invites.includes('clinic_email')) pass(report, 'pipeline from-lead uses clinic_email');
  else fail(report, 'from-lead field fix missing');
  const voicePreview = fs.readFileSync(path.join(UI, 'assets/js/voice-preview.js'), 'utf8');
  if (voicePreview.includes('live_opener') && voicePreview.includes('playLiveOpener')) {
    pass(report, 'voice preview live opener parity');
  } else fail(report, 'voice preview parity missing');
  const today = fs.readFileSync(path.join(UI, 'business/today.html'), 'utf8');
  if (today.includes('Go-live checklist') && today.includes("get('onboarding')")) {
    pass(report, 'pilot checklist UI');
  } else fail(report, 'pilot checklist UI missing');
  const payHtml = fs.readFileSync(path.join(UI, 'patients/pay.html'), 'utf8');
  if (payHtml.includes('zero-balance-state') && payHtml.includes('expired-state')) {
    pass(report, 'pay empty states');
  } else fail(report, 'pay empty states missing');
  if (fs.readFileSync(path.join(UI, 'assets/js/provider-shell.js'), 'utf8').includes('ppFetch')) {
    pass(report, 'BUG-6 ppFetch helper');
  } else fail(report, 'ppFetch missing');
  const agentHtml = fs.readFileSync(path.join(UI, 'business/agent.html'), 'utf8');
  if (agentHtml.includes('vaKillSwitch') && agentHtml.includes('vaCoverageMode')) {
    pass(report, 'agent coverage + kill switch UI');
  } else fail(report, 'agent controls UI missing');
  const callsHtml = fs.readFileSync(path.join(UI, 'business/calls.html'), 'utf8');
  if (callsHtml.includes('eligibility_status') && callsHtml.includes('copay_quote')) {
    pass(report, 'calls eligibility/copay/disposition columns');
  } else fail(report, 'calls dashboard enrichment missing');
  if (today.includes('kellyActivityChips') && fs.readFileSync(path.join(UI, 'assets/js/provider-shell.js'), 'utf8').includes('/api/customer/dashboard/agent/stats')) {
    pass(report, 'today voice-call enrichment rail');
  } else fail(report, 'today dashboard enrichment missing');
  if (payHtml.includes('clinic.name') && payHtml.includes('error-retry-btn')) {
    pass(report, 'pay branding + retry');
  } else fail(report, 'pay polish missing');
  const settingsHtml = fs.readFileSync(path.join(UI, 'business/settings.html'), 'utf8');
  if (settingsHtml.includes('data-settings-panel="credentials"') && settingsHtml.includes('PMS help')) {
    pass(report, 'settings credentials + PMS help');
  } else fail(report, 'settings batch-2 panels missing');
  if (fs.existsSync(path.join(ROOT, 'services/dashboard-call-enrichment.js'))) {
    pass(report, 'dashboard call enrichment service');
  } else fail(report, 'dashboard call enrichment missing');
  if (server.includes('/api/tenant/patients')) pass(report, 'tenant patients API wired');
  else fail(report, 'tenant patients API missing');
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
