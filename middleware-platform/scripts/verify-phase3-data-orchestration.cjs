'use strict';

const path = require('path');
const fs = require('fs');

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

  const required = [
    'migrations/102_phase3_data_orchestration.js',
    'services/tenant-roster-service.js',
    'services/patient-match-service.js',
    'services/e10-interim-service.js',
    'services/dental-ehr-routing-guard.js',
    'services/eligibility-session-store.js',
    'services/tenant-flags-service.js',
    'routes/tenant-roster.js',
    '__tests__/phase3-phi-isolation.test.js',
    '__tests__/phase3-data-orchestration.test.js'
  ];
  for (const f of required) {
    if (fs.existsSync(path.join(ROOT, f))) pass(report, `exists: ${f}`);
    else fail(report, `missing: ${f}`);
  }

  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  if (server.includes('tenant-roster')) pass(report, 'server wires tenant-roster routes');
  else fail(report, 'tenant-roster routes missing from server');

  if (server.includes('dental-ehr-routing-guard')) pass(report, '1upHealth dental guard on EHR connect');
  else fail(report, 'dental EHR guard missing');

  const intake = fs.readFileSync(path.join(ROOT, 'services/front-desk-intake.js'), 'utf8');
  if (intake.includes('fd_subscriber_id')) pass(report, 'front-desk subscriber/group fields');
  else fail(report, 'front-desk dental session fields missing');

  const ssot = fs.readFileSync(path.join(ROOT, 'services/kelly-rails/session-ssot.js'), 'utf8');
  if (ssot.includes('persistFrontDeskProjection')) pass(report, 'SSOT front-desk projection');
  else fail(report, 'persistFrontDeskProjection missing');

  const collect = fs.readFileSync(
    path.join(ROOT, 'services/kelly-tool-executor/collect-insurance.js'),
    'utf8'
  );
  if (collect.includes('eligibility-session-store')) pass(report, 'collect_insurance stores eligibility on session');
  else fail(report, 'eligibility session store not wired');

  try {
    const db = require('../database');
    if (db.db) {
      const cols = db.db.prepare('PRAGMA table_info(clinics)').all().map((c) => c.name);
      if (cols.includes('office_type')) pass(report, 'DB clinics.office_type');
      else fail(report, 'clinics.office_type missing');
      const apptCols = db.db.prepare('PRAGMA table_info(appointments)').all().map((c) => c.name);
      if (apptCols.includes('last_eligibility_id')) pass(report, 'DB appointments.last_eligibility_id');
      else fail(report, 'appointments.last_eligibility_id missing');
    }
  } catch (e) {
    fail(report, `database: ${e.message}`);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
