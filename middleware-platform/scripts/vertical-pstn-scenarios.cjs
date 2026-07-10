#!/usr/bin/env node
'use strict';

/**
 * Multi-vertical PSTN scenario matrix runner (Phase 7.3).
 * Structural mode (default): validates registry + documents live checklist.
 * Live mode: requires TWILIO + RETELL + bound tenant DIDs per vertical.
 *
 * Usage:
 *   node scripts/vertical-pstn-scenarios.cjs
 *   node scripts/vertical-pstn-scenarios.cjs --vertical=dental
 *   VERTICAL_PSTN_LIVE=1 node scripts/vertical-pstn-scenarios.cjs --vertical=dermatology
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const REGISTRIES = {
  dental: require('../e2e/scenario-registry/dental-front-desk.cjs').DENTAL_PSTN_SCENARIOS,
  dermatology: require('../e2e/scenario-registry/dermatology-clinical.cjs').DERMATOLOGY_PSTN_SCENARIOS,
  healthcare_clinic: require('../e2e/scenario-registry/healthcare-clinic.cjs').HEALTHCARE_CLINIC_PSTN_SCENARIOS,
  small_business: require('../e2e/scenario-registry/small-business.cjs').SMALL_BUSINESS_PSTN_SCENARIOS
};

const VERTICAL_ENV = {
  dental: {
    did: 'VERTICAL_DENTAL_DID',
    customer: 'VERTICAL_DENTAL_CUSTOMER_ID',
    clinic: 'VERTICAL_DENTAL_CLINIC_ID'
  },
  dermatology: {
    did: 'VERTICAL_DERM_DID',
    customer: 'VERTICAL_DERM_CUSTOMER_ID',
    clinic: 'VERTICAL_DERM_CLINIC_ID'
  },
  healthcare_clinic: {
    did: 'VERTICAL_HC_DID',
    customer: 'VERTICAL_HC_CUSTOMER_ID',
    clinic: 'VERTICAL_HC_CLINIC_ID'
  },
  small_business: {
    did: 'VERTICAL_SB_DID',
    customer: 'VERTICAL_SB_CUSTOMER_ID',
    clinic: 'VERTICAL_SB_CLINIC_ID'
  }
};

function parseVertical() {
  const hit = process.argv.find((a) => a.startsWith('--vertical='));
  if (hit) return hit.split('=')[1];
  return null;
}

function truthy(v) {
  return ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());
}

function structuralCheck(vertical, scenarios) {
  const issues = [];
  if (!scenarios?.length) issues.push('empty scenario list');
  for (const s of scenarios) {
    if (!s.id) issues.push('scenario missing id');
    if (!s.title) issues.push(`${s.id}: missing title`);
    if (!Array.isArray(s.utterances) || s.utterances.length === 0) {
      issues.push(`${s.id}: no utterances`);
    }
  }
  return { vertical, count: scenarios.length, ok: issues.length === 0, issues };
}

function livePrereqs(vertical) {
  const keys = VERTICAL_ENV[vertical];
  const did = process.env[keys.did] || process.env.CAPSTONE_TENANT_DID;
  const customer = process.env[keys.customer] || process.env.CAPSTONE_CUSTOMER_ID;
  const missing = [];
  if (!did) missing.push(keys.did);
  if (!customer) missing.push(keys.customer);
  if (!process.env.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
  if (!process.env.RETELL_API_KEY) missing.push('RETELL_API_KEY');
  return { ready: missing.length === 0, missing, did, customer };
}

async function runLiveVertical(vertical, scenarios) {
  const prep = livePrereqs(vertical);
  if (!prep.ready) {
    return {
      vertical,
      mode: 'live',
      pass: false,
      blocked: true,
      missing: prep.missing,
      note: 'Coordinate with operator to set vertical env vars — see docs/qa/pstn-vertical-matrix.md'
    };
  }

  const results = [];
  for (const scenario of scenarios) {
    results.push({
      id: scenario.id,
      title: scenario.title,
      status: 'MANUAL_PSTN_REQUIRED',
      did: prep.did,
      utterances: scenario.utterances,
      expectedTools: scenario.expectedTools,
      assertions: scenario.assertions,
      log_path: `test-results/pstn-matrix/${vertical}/${scenario.id}.json`
    });
  }

  const outDir = path.join(__dirname, '..', 'test-results', 'pstn-matrix', vertical);
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = {
    vertical,
    generated_at: new Date().toISOString(),
    did: prep.did,
    customer_id: prep.customer,
    scenarios: results,
    note: 'Place real PSTN calls and record pass/fail per scenario'
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    vertical,
    mode: 'live',
    pass: false,
    blocked: true,
    manifest: path.join(outDir, 'manifest.json'),
    note: 'Live PSTN matrix manifest written — operator must execute calls and mark results'
  };
}

async function main() {
  const live = truthy(process.env.VERTICAL_PSTN_LIVE);
  const only = parseVertical();
  const verticals = only ? [only] : Object.keys(REGISTRIES);
  const report = { mode: live ? 'live' : 'structural', verticals: [], pass: true };

  for (const vertical of verticals) {
    const scenarios = REGISTRIES[vertical];
    if (!scenarios) {
      report.verticals.push({ vertical, ok: false, error: 'unknown vertical' });
      report.pass = false;
      continue;
    }

    const structural = structuralCheck(vertical, scenarios);
    console.log(`\n=== ${vertical} (${scenarios.length} scenarios) ===`);
    console.log(structural.ok ? '✅ structural' : `❌ structural: ${structural.issues.join(', ')}`);
    if (!structural.ok) report.pass = false;

    let liveResult = null;
    if (live) {
      liveResult = await runLiveVertical(vertical, scenarios);
      console.log(`live: ${liveResult.blocked ? 'BLOCKED (manual PSTN)' : liveResult.pass ? 'PASS' : 'FAIL'}`);
      if (liveResult.blocked) report.pass = false;
    }

    report.verticals.push({ ...structural, live: liveResult });
  }

  const outPath = path.join(__dirname, '..', 'test-results', 'pstn-matrix', 'summary.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n' + JSON.stringify(report, null, 2));
  if (!live) {
    console.log('\nStructural matrix OK. For live PSTN: VERTICAL_PSTN_LIVE=1 node scripts/vertical-pstn-scenarios.cjs');
    process.exit(report.pass ? 0 : 1);
  }
  process.exit(report.pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
