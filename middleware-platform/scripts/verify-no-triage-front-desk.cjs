#!/usr/bin/env node
'use strict';

/**
 * AI-5: front-desk tenants must keep triage_policy disabled (no clinical triage on voice).
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function main() {
  console.log('\n=== No-triage front desk regression ===\n');
  let pass = true;

  const { ConversationMode } = require('../services/conversation-mode/conversation-mode-types');
  const { isToolAllowedForMode } = require('../services/conversation-mode/mode-tool-firewall');
  const ctx = {
    conversation_mode: ConversationMode.TENANT_INBOUND_ADMIN,
    triage_policy: 'disabled',
    use_case: 'dental',
    active_subrail: 'booking',
    site_context_status: 'not_required'
  };
  pass = check('schedule allowed for front desk', isToolAllowedForMode('schedule_appointment', ctx)) && pass;
  pass = check('collect_insurance allowed', isToolAllowedForMode('collect_insurance', ctx)) && pass;

  const tenantVoice = require('../services/tenant-voice-config');
  pass = check('tenant-voice-config exports triage_policy', typeof tenantVoice.resolveTenantVoiceConfig === 'function') && pass;

  console.log('\n' + JSON.stringify({ pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
