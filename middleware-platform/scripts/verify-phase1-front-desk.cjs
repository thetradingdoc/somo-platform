#!/usr/bin/env node
'use strict';

/**
 * Phase 1 tenant architecture verification — structural + behavioral checks.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function fail(report, msg) {
  report.checks.push({ ok: false, message: msg });
  report.pass = false;
}

function pass(report, msg) {
  report.checks.push({ ok: true, message: msg });
}

function main() {
  const report = { pass: true, checks: [] };

  const tenantCfg = path.join(ROOT, 'services/tenant-voice-config.js');
  if (fs.existsSync(tenantCfg)) {
    const body = fs.readFileSync(tenantCfg, 'utf8');
    if (body.includes('resolveTenantVoiceConfig') && body.includes('assessConfigStatus')) {
      pass(report, 'TenantVoiceConfig resolver present');
    } else {
      fail(report, 'TenantVoiceConfig resolver incomplete');
    }
  } else {
    fail(report, 'Missing tenant-voice-config.js');
  }

  const provision = path.join(ROOT, 'services/saas-tenant-provision.js');
  if (fs.readFileSync(provision, 'utf8').includes('ensureCustomerClinicLink')) {
    pass(report, 'Provision writes customer_clinics');
  } else {
    fail(report, 'Provision missing customer_clinics link');
  }

  const ws = path.join(ROOT, 'webhooks/retell-websocket.js');
  if (fs.readFileSync(ws, 'utf8').includes("_setSessionMeta(callId, 'clinic_id'")) {
    pass(report, 'WebSocket stamps clinic_id session meta');
  } else {
    fail(report, 'WebSocket session meta stamp missing');
  }

  const settingsRoute = path.join(ROOT, 'routes/voice-agent-settings.js');
  if (fs.readFileSync(settingsRoute, 'utf8').includes('/config-status')) {
    pass(report, 'GET /api/voice-agent/config-status route');
  } else {
    fail(report, 'Missing config-status API');
  }

  const intake = path.join(ROOT, 'services/front-desk-intake.js');
  const intakeBody = fs.readFileSync(intake, 'utf8');
  if (intakeBody.includes('shouldTransferOnIntakeFailure')) {
    pass(report, 'Intake failure → transfer counter');
  } else {
    fail(report, 'Intake transfer counter missing');
  }

  const firewall = path.join(ROOT, 'services/conversation-mode/mode-tool-firewall.js');
  if (fs.readFileSync(firewall, 'utf8').includes('frontDeskIntakeComplete')) {
    pass(report, 'mode-tool-firewall blocks booking until intake');
  } else {
    fail(report, 'mode-tool-firewall intake block missing');
  }

  const booking = path.join(ROOT, 'services/booking-service.js');
  if (fs.readFileSync(booking, 'utf8').includes('preferred_language')) {
    pass(report, 'booking-service persists preferred_language');
  } else {
    fail(report, 'booking-service locale pipe missing');
  }

  const migration = path.join(ROOT, 'migrations/097_appointments_preferred_language.js');
  if (fs.existsSync(migration)) pass(report, 'Migration 097 preferred_language');
  else fail(report, 'Missing migration 097');

  const promptDoc = path.join(ROOT, '../docs/voice-agent/prompts/kelly-voice-agent-prompt.md');
  if (fs.existsSync(promptDoc)) {
    const doc = fs.readFileSync(promptDoc, 'utf8');
    if (doc.includes('Front Desk') && !doc.includes('OPQRST field per turn')) {
      pass(report, 'kelly-voice-agent-prompt.md is front-desk oriented');
    } else {
      fail(report, 'kelly-voice-agent-prompt.md still OPQRST-heavy');
    }
  }

  const forwardRunbook = path.join(ROOT, '../docs/runbooks/CALL_FORWARDING_SETUP.md');
  if (fs.existsSync(forwardRunbook)) pass(report, 'CALL_FORWARDING_SETUP runbook exists');
  else fail(report, 'Missing CALL_FORWARDING_SETUP runbook');

  const mig100 = path.join(ROOT, 'migrations/100_phase1_voice_runtime.js');
  if (fs.existsSync(mig100)) pass(report, 'Migration 100 phase1 voice runtime');
  else fail(report, 'Missing migration 100');

  const runtimeSrc = fs.readFileSync(path.join(ROOT, 'services/voice-agent-runtime.js'), 'utf8');
  if (runtimeSrc.includes('coverage_off') && runtimeSrc.includes('forward_pstn')) {
    pass(report, 'voice-agent-runtime PSTN forward admission');
  } else {
    fail(report, 'voice-agent-runtime missing PSTN forward admission');
  }

  const openerSrc = fs.readFileSync(path.join(ROOT, 'services/call-opener-resolver.js'), 'utf8');
  if (openerSrc.includes('buildAiDisclosureLine')) pass(report, 'AI disclosure in call-opener-resolver');
  else fail(report, 'AI disclosure missing from call-opener-resolver');

  const twilioSrc = fs.readFileSync(path.join(ROOT, 'services/twilio-phone-service.js'), 'utf8');
  if (twilioSrc.includes('NYC_AREA_CODES')) pass(report, 'NYC area code Twilio fallback');
  else fail(report, 'NYC area codes not in twilio-phone-service');

  const selfPaySubrail = path.join(ROOT, 'services/conversation-mode/subrails/self-pay-subrail.js');
  if (fs.existsSync(selfPaySubrail)) pass(report, 'self_pay subrail module');
  else fail(report, 'Missing self_pay subrail');

  const dentalAlias = fs.readFileSync(path.join(ROOT, 'services/prompt-profile-templates.js'), 'utf8');
  if (dentalAlias.includes('dental_office')) pass(report, 'dental_office profile alias');
  else fail(report, 'dental_office alias missing');

  const { evaluateCallAdmission } = require('../services/voice-agent-runtime');
  const fwd = evaluateCallAdmission({
    agentEnabled: false,
    unavailableMessage: 'Off',
    afterHoursMessage: 'Closed',
    businessHours: null,
    transferNumber: '+15550001111',
    coverageMode: 'full_replacement',
    coverageHours: null,
    afterHoursAction: 'message_only',
    greeting: 'Hi'
  });
  if (fwd.action === 'forward_pstn') pass(report, 'kill-switch admission forwards PSTN');
  else fail(report, 'kill-switch admission behavioral check failed');

  try {
    const { assessConfigStatus, voiceHoursToSchedulingColumns } = require('../services/tenant-voice-config');
    const status = assessConfigStatus({
      customer_clinics_linked: true,
      clinic_id: 'c1',
      retell_agent_id: 'a1',
      prompt_profile_id: 'p1',
      transfer_number: '+1',
      business_hours: { mon: '09:00-17:00', tue: '09:00-17:00' },
      language_mode: 'en_only',
      clinic_email: 'a@b.com'
    });
    if (!status.ready) fail(report, 'assessConfigStatus behavioral check failed');
    else pass(report, 'assessConfigStatus behavioral check');
    const cols = voiceHoursToSchedulingColumns({ mon: '09:00-17:00' });
    if (!cols.business_days?.includes(1)) fail(report, 'voiceHoursToSchedulingColumns behavioral check failed');
    else pass(report, 'hours sync helper behavioral check');
  } catch (e) {
    fail(report, `tenant-voice-config require failed: ${e.message}`);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
