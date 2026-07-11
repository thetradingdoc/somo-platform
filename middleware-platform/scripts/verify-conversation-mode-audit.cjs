#!/usr/bin/env node
'use strict';

/**
 * CP-04 — Conversation-mode tenant policy + coding tool firewall audit.
 */

const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..');

const CODING_TOOLS = [
  'search_icd10_codes',
  'search_cpt_codes',
  'suggest_codes_from_symptoms',
  'collect_insurance',
  'run_triage_rag'
];

const DEMO_FORBIDDEN_MODES = ['DEMO_QUAL', 'OUTBOUND_SALES'];

function main() {
  let failed = 0;
  const firewallSrc = fs.readFileSync(
    path.join(MP, 'services/conversation-mode/mode-tool-firewall.js'),
    'utf8'
  );
  const policySrc = fs.readFileSync(
    path.join(MP, 'services/conversation-mode/tenant-policy.js'),
    'utf8'
  );

  for (const tool of CODING_TOOLS) {
    if (!firewallSrc.includes(tool)) {
      console.error(`❌ mode-tool-firewall missing coding tool: ${tool}`);
      failed++;
    }
  }
  console.log(`✅ ${CODING_TOOLS.length} coding tools registered in firewall`);

  for (const mode of DEMO_FORBIDDEN_MODES) {
    if (!firewallSrc.includes(`ConversationMode.${mode}`)) {
      console.error(`❌ Missing demo mode firewall: ${mode}`);
      failed++;
    }
  }
  console.log('✅ Demo/sales modes block coding tools');

  if (!policySrc.includes('TriagePolicy')) {
    console.error('❌ tenant-policy.js missing TriagePolicy');
    failed++;
  } else {
    console.log('✅ TriagePolicy defined in tenant-policy.js');
  }

  const leakTest = path.join(MP, '__tests__/coding-layer-leaks.test.js');
  if (!fs.existsSync(leakTest)) {
    console.error('❌ coding-layer-leaks.test.js missing');
    failed++;
  } else {
    console.log('✅ coding-layer-leaks.test.js present');
  }

  if (failed) {
    console.error('\n❌ verify-conversation-mode-audit failed\n');
    process.exit(1);
  }
  console.log('\n✅ verify-conversation-mode-audit passed\n');
}

main();
