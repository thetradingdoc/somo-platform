#!/usr/bin/env node
/**
 * F-2 burn-in verification — Cloud Run env + optional DB pivot/metrics scan.
 *
 * Usage:
 *   node scripts/opqrst/opqrst-f2-burn-in-verify.cjs
 *   DB_PATH=./middleware-staging.db node scripts/opqrst/opqrst-f2-burn-in-verify.cjs
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVICE = process.env.GCP_SERVICE || 'somo-middleware';
const REGION = process.env.GCP_REGION || 'us-central1';
const PROJECT = process.env.GCP_PROJECT || 'somo-callsomo';

function gcloudEnv() {
  const args = ['run', 'services', 'describe', SERVICE, '--region', REGION, '--format', 'json'];
  if (PROJECT) args.unshift('--project', PROJECT);
  const r = spawnSync('gcloud', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    return { error: r.stderr || r.stdout || 'gcloud failed' };
  }
  const json = JSON.parse(r.stdout);
  const env = {};
  for (const e of json.spec?.template?.spec?.containers?.[0]?.env || []) {
    env[e.name] = e.value ?? '(secret)';
  }
  return {
    revision: json.status?.latestReadyRevisionName,
    url: json.status?.url,
    env
  };
}

function gateEnabled(envVal) {
  if (envVal == null || envVal === '(unset)' || envVal === '(secret)') {
    return 'default_on_in_code';
  }
  const v = String(envVal).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' ? true : false;
}

function scanDb(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  const { execFileSync } = require('child_process');
  let r5a = null;
  try {
    const r5 = execFileSync(process.execPath, ['scripts/opqrst/opqrst-billing-pivot-frequency.cjs'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_PATH: dbPath },
      encoding: 'utf8'
    });
    const jsonLine = r5.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    r5a = jsonLine ? JSON.parse(jsonLine) : { raw: r5.trim().slice(-500) };
  } catch (e) {
    r5a = { error: e.message };
  }
  return { dbPath, r5a };
}

function main() {
  const report = { ts: new Date().toISOString(), service: SERVICE, region: REGION, project: PROJECT };
  const cloud = gcloudEnv();
  report.cloudRun = cloud;

  if (cloud.error) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const gateVal = cloud.env?.OPQRST_FIELD_GATE_ENABLED ?? '(unset)';
  const enabled = gateEnabled(gateVal);
  report.opqrst_gate = { env: gateVal, effective: enabled };

  const dbPath = process.env.DB_PATH;
  if (dbPath) {
    report.dbScan = scanDb(dbPath);
    if (report.dbScan?.r5a) report.r5a = report.dbScan.r5a;
  }

  const ok =
    enabled === true ||
    enabled === 'default_on_in_code';
  report.ok = ok;
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exit(1);
}

main();
