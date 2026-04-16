#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LOCK_PATH = path.join(__dirname, '..', 'taxonomy', 'category-phase2-measurement-lock.v1.json');
const OUT_PATH = path.join(__dirname, '..', 'tmp', 'category-phase2-baseline.locked.json');

function run(command) {
  const out = spawnSync(command, { shell: true, cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  if (out.status !== 0) {
    console.error(out.stdout || '');
    console.error(out.stderr || '');
    throw new Error(`command_failed: ${command}`);
  }
  return out.stdout || '';
}

function main() {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  const auditOut = run(lock.frozen_audit_command);
  run(lock.frozen_observability_command);
  const obsPath = path.join(__dirname, '..', 'tmp', 'category-route-observability.candidate.json');
  const obs = JSON.parse(fs.readFileSync(obsPath, 'utf8'));

  const baseline = {
    generated_at: new Date().toISOString(),
    measurement_lock: lock,
    audit_output_raw: auditOut,
    observability: {
      total: obs.total,
      unknown: obs.unknown,
      unknown_rate: obs.unknown_rate,
      byRoute: obs.byRoute,
      byResolverSource: obs.byResolverSource,
      byCatalogSource: obs.byCatalogSource
    }
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`[phase2-baseline-freeze] wrote ${OUT_PATH}`);
}

main();
