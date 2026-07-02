#!/usr/bin/env node
'use strict';

/**
 * Dental PSTN eval gate (AI-1, LO-P0-5) — scenario pack + firewall regression.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

  const scenarioPath = path.join(ROOT, 'scripts/dental-pstn-scenarios.cjs');
  if (!fs.existsSync(scenarioPath)) {
    fail(report, 'missing scripts/dental-pstn-scenarios.cjs');
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  let scenariosMod;
  try {
    scenariosMod = require('./dental-pstn-scenarios.cjs');
  } catch (e) {
    fail(report, `dental-pstn-scenarios require failed: ${e.message}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const { scenarios, run } = scenariosMod;
  if (!Array.isArray(scenarios) || scenarios.length < 10) {
    fail(report, `expected >=10 scenarios, got ${scenarios?.length || 0}`);
  } else {
    pass(report, `dental PSTN pack has ${scenarios.length} scenarios`);
  }

  if (typeof run !== 'function') {
    fail(report, 'dental-pstn-scenarios must export run()');
  }

  try {
    const { isToolAllowedForMode } = require('../services/conversation-mode/mode-tool-firewall');
    const { ConversationMode, Subrail } = require('../services/conversation-mode/conversation-mode-types');

    function ctxForTool(tool) {
      const base = {
        conversation_mode: ConversationMode.TENANT_INBOUND_ADMIN,
        triage_policy: 'disabled',
        use_case: 'dental',
        site_context_status: 'not_required'
      };
      if (tool === 'request_patient_payment' || tool === 'collect_insurance') {
        return { ...base, active_subrail: Subrail.COPAY_LINK };
      }
      if (tool === 'transfer_call') {
        return { ...base, active_subrail: Subrail.HANDOFF };
      }
      return { ...base, active_subrail: Subrail.BOOKING };
    }

    const dentalTools = [
      'collect_insurance',
      'request_patient_payment',
      'schedule_appointment',
      'transfer_call',
      'get_available_slots'
    ];
    const blocked = dentalTools.filter((t) => !isToolAllowedForMode(t, ctxForTool(t)));
    if (blocked.length) {
      fail(report, `firewall blocks dental tools: ${blocked.join(', ')}`);
    } else {
      pass(report, 'mode-tool-firewall allows dental front-desk tools');
    }
  } catch (e) {
    fail(report, `firewall regression: ${e.message}`);
  }

  for (const s of scenarios || []) {
    if (!s.id || !Array.isArray(s.utterances) || !s.utterances.length) {
      fail(report, `invalid scenario structure: ${s.id || '(no id)'}`);
    }
  }
  if (report.pass) pass(report, 'all scenarios have id + utterances');

  const esFixture = path.join(ROOT, 'tests/fixtures/dental-pstn-es-fixture.json');
  if (fs.existsSync(esFixture)) {
    pass(report, 'Spanish dental PSTN fixture exists');
  } else {
    fail(report, 'missing tests/fixtures/dental-pstn-es-fixture.json');
  }

  const opener = fs.readFileSync(path.join(ROOT, 'services/call-opener-resolver.js'), 'utf8');
  if (opener.includes('ai_disclosure_enabled') && opener.includes('buildDefaultOutboundOpener')) {
    pass(report, 'opener disclosure + outbound defaults in resolver');
  } else {
    fail(report, 'call-opener-resolver missing disclosure/outbound helpers');
  }

  const inline = spawnSync('node', ['scripts/dental-pstn-scenarios.cjs', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DENTAL_PSTN_HTTP: '0', DENTAL_PSTN_STRUCTURAL: '1' }
  });
  if (inline.status === 0) {
    pass(report, 'inline dental PSTN replay passed');
  } else {
    fail(report, `inline dental PSTN replay failed: ${inline.stdout || inline.stderr}`);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
