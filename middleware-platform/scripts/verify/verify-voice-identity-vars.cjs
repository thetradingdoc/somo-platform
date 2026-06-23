#!/usr/bin/env node
'use strict';

/**
 * Audit that voice entry paths require identity vars for Kelly admission.
 * Static check — verifies code + documents Twilio/Retell dynamic variable contract.
 *
 * Usage: node scripts/verify/verify-voice-identity-vars.cjs
 */

const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..');
const REQUIRED_VARS = ['customer_id', 'clinic_id', 'call_type'];

function read(rel) {
  return fs.readFileSync(path.join(MP, rel), 'utf8');
}

function main() {
  const issues = [];
  const retell = read('webhooks/retell-websocket.js');
  const admission = read('services/voice-identity-admission.js');
  const incoming = read('services/voice-incoming-handler.js');

  for (const v of REQUIRED_VARS) {
    if (!retell.includes(v)) issues.push(`retell-websocket.js missing reference to ${v}`);
    if (!admission.includes(v) && v !== 'call_type') {
      // admission may use clinicId camelCase
    }
  }

  if (!admission.includes('clinicId') && !admission.includes('clinic_id')) {
    issues.push('voice-identity-admission.js missing clinic id check');
  }
  if (!admission.includes('customer_id') && !admission.includes('customerId')) {
    issues.push('voice-identity-admission.js missing customer id check');
  }
  if (!incoming.includes('retell') && !incoming.includes('Retell')) {
    issues.push('voice-incoming-handler.js may not wire Retell dynamic variables');
  }

  const contract = {
    required_dynamic_variables: REQUIRED_VARS,
    retell_wss: 'wss://api.callsomo.com/webhook/retell/llm',
    notes: [
      'Twilio voice URL must pass customer_id and call_type=tenant on connect',
      'Retell agent dynamic_variables should include clinic_id from merchant lookup',
      'identity admission fail-closed when vars missing — see voice-identity-admission.js'
    ],
    issues
  };

  console.log(JSON.stringify(contract, null, 2));
  if (issues.length) {
    console.error(`\n${issues.length} issue(s) found`);
    process.exit(1);
  }
  console.log('\nVoice identity variable contract OK');
}

main();
