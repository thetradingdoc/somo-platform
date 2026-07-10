#!/usr/bin/env node
'use strict';

/**
 * Pilot scenario matrix — doc parity with dental-pstn-scenarios.cjs
 * Usage: node scripts/verify-pilot-scenario-matrix.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const DOC = path.join(REPO, 'docs/voice-agent/pilot-scenario-matrix.md');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function main() {
  console.log('\n=== Pilot scenario matrix gate ===\n');
  let pass = true;

  pass = check('pilot-scenario-matrix.md exists', fs.existsSync(DOC)) && pass;
  pass = check('dental-pstn-scenarios.cjs exists', fs.existsSync(path.join(ROOT, 'scripts/dental-pstn-scenarios.cjs'))) && pass;
  pass = check('scenario registry exists', fs.existsSync(path.join(ROOT, 'e2e/scenario-registry/dental-front-desk.cjs'))) && pass;
  pass = check('dermatology registry exists', fs.existsSync(path.join(ROOT, 'e2e/scenario-registry/dermatology-clinical.cjs'))) && pass;
  pass = check('healthcare_clinic registry exists', fs.existsSync(path.join(ROOT, 'e2e/scenario-registry/healthcare-clinic.cjs'))) && pass;
  pass = check('small_business registry exists', fs.existsSync(path.join(ROOT, 'e2e/scenario-registry/small-business.cjs'))) && pass;

  const { scenarios } = require('./dental-pstn-scenarios.cjs');
  const registry = require('../e2e/scenario-registry/dental-front-desk.cjs');
  pass = check('registry exports DENTAL-001', registry.DENTAL_PSTN_SCENARIOS.some((s) => s.id === 'DENTAL-001')) && pass;
  pass = check('registry exports multilang ZH-1', registry.MULTILANG_SCENARIOS.some((s) => s.id === 'ZH-1-fallback')) && pass;
  const doc = fs.readFileSync(DOC, 'utf8');

  pass = check('scenario count >= 10', scenarios.length >= 10, `found=${scenarios.length}`) && pass;

  const missing = scenarios.filter((s) => !doc.includes(s.id));
  pass = check('all scenario IDs documented', missing.length === 0, missing.map((s) => s.id).join(', ') || undefined) && pass;

  const requiredAssertions = ['NO_PHI_LEAK', 'COPAY_QUOTE', 'WARM_TRANSFER', 'STEDI_DOWN_HANDOFF'];
  for (const a of requiredAssertions) {
    pass = check(`doc mentions ${a}`, doc.includes(a)) && pass;
  }

  pass = check('doc links dental-pstn-scenarios', doc.includes('dental-pstn-scenarios.cjs')) && pass;
  pass = check('doc links golden-loop verify', doc.includes('verify:phase2-golden-loop')) && pass;

  console.log('\n' + JSON.stringify({ pass, scenario_count: scenarios.length }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
