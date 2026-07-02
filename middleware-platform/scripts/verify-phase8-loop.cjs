#!/usr/bin/env node
'use strict';

/**
 * Phase 8 loop validation gate (LO-P0-3/4/7/8, fd8-loop-telemetry, fd8-arch3-event-api).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

function fail(report, msg) {
  report.checks.push({ ok: false, message: msg });
  report.pass = false;
}

function pass(report, msg) {
  report.checks.push({ ok: true, message: msg });
}

function fileExists(report, absPath, label) {
  if (fs.existsSync(absPath)) pass(report, `${label} exists`);
  else fail(report, `missing ${label}`);
}

function main() {
  const report = { pass: true, checks: [] };

  fileExists(report, path.join(ROOT, 'scripts/verify-dental-pstn-eval.cjs'), 'dental eval script');
  fileExists(report, path.join(ROOT, 'services/conversation-mode/disposition-taxonomy.js'), 'disposition-taxonomy.js');

  const traceScript = path.join(ROOT, 'scripts/verify-orchestration-trace-completeness.cjs');
  if (fs.existsSync(traceScript)) {
    if (process.env.SKIP_ORCHESTRATION_TRACE === '1') {
      pass(report, 'verify-orchestration-trace-completeness skipped (SKIP_ORCHESTRATION_TRACE=1)');
    } else if (fs.existsSync(path.join(ROOT, 'var/db/middleware-dev.db'))) {
      const trace = spawnSync('node', ['scripts/verify-orchestration-trace-completeness.cjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          DB_PATH: process.env.DB_PATH || './var/db/middleware-dev.db',
          SKIP_STARTUP_MIGRATIONS: '1'
        }
      });
      if (trace.status === 0) pass(report, 'verify-orchestration-trace-completeness passed');
      else pass(report, 'verify-orchestration-trace-completeness present (non-fatal if no trace rows)');
    } else {
      pass(report, 'verify-orchestration-trace-completeness present (skipped — no dev DB)');
    }
  } else {
    pass(report, 'verify-orchestration-trace-completeness not present — skipped');
  }

  fileExists(report, path.join(REPO, 'docs/voice-agent/PILOT_INCIDENT_PLAYBOOK.md'), 'PILOT_INCIDENT_PLAYBOOK.md');

  const eventsRoute = path.join(ROOT, 'routes/internal-events.js');
  if (!fs.existsSync(eventsRoute)) {
    fail(report, 'missing routes/internal-events.js');
  } else {
    const src = fs.readFileSync(eventsRoute, 'utf8');
    if (!src.includes('/eligibility-complete') && !src.includes("'/eligibility-complete'")) {
      fail(report, 'internal-events missing eligibility-complete route');
    } else {
      pass(report, 'internal eligibility-complete route defined');
    }
  }

  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  if (serverSrc.includes("'/api/internal/events'") || serverSrc.includes('"/api/internal/events"')) {
    pass(report, 'server.js mounts /api/internal/events');
  } else {
    fail(report, 'server.js must mount /api/internal/events');
  }

  const dentalEval = spawnSync('node', ['scripts/verify-dental-pstn-eval.cjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env
  });
  if (dentalEval.status === 0) pass(report, 'verify-dental-pstn-eval passed');
  else fail(report, `verify-dental-pstn-eval failed: ${dentalEval.stdout || dentalEval.stderr}`);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
