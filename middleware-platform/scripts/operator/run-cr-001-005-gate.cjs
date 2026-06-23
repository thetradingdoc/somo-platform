#!/usr/bin/env node
'use strict';

/**
 * CR-001–005 operator gate: run Cloud Run Kelly env verify + write evidence JSON.
 *
 * Usage:
 *   node scripts/operator/run-cr-001-005-gate.cjs
 *   GCP_PROJECT=somo-callsomo GCP_SERVICE=somo-middleware node scripts/operator/run-cr-001-005-gate.cjs
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE_DIR = path.join(ROOT, 'var/evidence/cr-001-005');

function runVerify() {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/verify/verify-kelly-rails-cloudrun-env.cjs')],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
    }
  );
  return r;
}

function parseSnapshot(stdout) {
  const text = String(stdout || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function assertChecks(env = {}) {
  const errors = [];
  const warnings = [];

  if (String(env.KELLY_RAILS_V2 || '') !== '1') {
    errors.push({ id: 'CR-004', message: 'KELLY_RAILS_V2 must be 1' });
  }
  const hybrid = String(env.KELLY_ALLOW_HYBRID_GRAPH || '0').toLowerCase();
  if (hybrid === '1' || hybrid === 'true') {
    errors.push({ id: 'CR-004', message: 'KELLY_ALLOW_HYBRID_GRAPH must be 0 or unset' });
  }
  const pct = env.KELLY_RAILS_ROLLOUT_PCT;
  if (pct != null && pct !== '' && parseFloat(pct) < 1) {
    errors.push({ id: 'CR-004', message: 'KELLY_RAILS_ROLLOUT_PCT must be 1' });
  }
  if (String(env.CONVERSATION_MODE_ROUTING || 'shadow').toLowerCase() !== 'enforce') {
    errors.push({ id: 'CR-002', message: 'CONVERSATION_MODE_ROUTING must be enforce' });
  }
  const gate = String(env.OPQRST_FIELD_GATE_ENABLED ?? '1').trim().toLowerCase();
  if (gate === '0' || gate === 'false' || gate === 'no') {
    errors.push({ id: 'CR-001', message: 'OPQRST_FIELD_GATE_ENABLED must be 1 or unset' });
  }

  const tenantEnforce = String(env.CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN || '0').toLowerCase();
  if (tenantEnforce !== '1' && tenantEnforce !== 'true') {
    warnings.push({
      id: 'CR-003',
      message:
        'CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN is not 1 — enable only after 48h clean shadow telemetry',
    });
  }

  return { errors, warnings };
}

function main() {
  const startedAt = new Date().toISOString();
  const verify = runVerify();
  const snapshot = parseSnapshot(verify.stdout);
  const env = snapshot?.env || {};
  const errors = [];
  const warnings = [];

  if (verify.status !== 0) {
    errors.push({
      id: 'CR-001',
      message: 'verify:kelly-rails-cloudrun failed — check gcloud auth and Cloud Run access',
    });
  } else if (!snapshot?.env || Object.keys(snapshot.env).length === 0) {
    errors.push({
      id: 'CR-001',
      message: 'Could not parse env snapshot from verify:kelly-rails-cloudrun stdout',
    });
  } else {
    const checks = assertChecks(env);
    errors.push(...checks.errors);
    warnings.push(...checks.warnings);
  }

  const passed = verify.status === 0 && errors.length === 0;

  const evidence = {
    ticket: 'CR-001-005',
    timestamp: startedAt,
    service: snapshot?.service || process.env.GCP_SERVICE || 'somo-middleware',
    region: snapshot?.region || process.env.GCP_REGION || 'us-central1',
    revision: snapshot?.revision || null,
    env,
    passed,
    verify_exit_code: verify.status,
    errors,
    warnings,
    cr005_note: 'Deploy guard: callsomo-terminal-cutover.sh deploy-api fails on shadow routing',
  };

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const outFile = path.join(EVIDENCE_DIR, `${startedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence written: ${outFile}`);

  if (warnings.length) {
    console.warn('\nManual follow-up:');
    for (const w of warnings) console.warn(`  [${w.id}] ${w.message}`);
    console.warn('  See docs/runbooks/CR-001-005-OPERATOR-CHECKLIST.md');
  }

  if (!passed) {
    if (verify.stderr) console.error(verify.stderr);
    if (errors.length) {
      console.error('\nGate FAILED:');
      for (const e of errors) console.error(`  [${e.id}] ${e.message}`);
    }
    process.exit(1);
  }

  console.log('\nGate PASSED (CR-001, CR-002, CR-004 automated checks)');
  process.exit(0);
}

main();
