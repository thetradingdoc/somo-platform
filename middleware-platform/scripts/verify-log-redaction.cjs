#!/usr/bin/env node

'use strict';



/**

 * Structural audit — eligibility + payment paths must not log raw PHI.

 * Usage: node scripts/verify-log-redaction.cjs

 */



const fs = require('fs');

const path = require('path');



const ROOT = path.join(__dirname, '..');



function auditCheckEligibility(filePath, report) {

  function check(name, ok, detail) {

    report.checks.push({ file: filePath, name, ok, detail: detail || null });

    if (!ok) report.pass = false;

    console.log(`${ok ? '✅' : '❌'} [insurance] ${name}${detail ? `: ${detail}` : ''}`);

  }



  if (!fs.existsSync(filePath)) {

    check('insurance-service.js exists', false, filePath);

    return;

  }



  const body = fs.readFileSync(filePath, 'utf8');

  check('secure-logger import', /require\(['"]\.\/secure-logger['"]\)/.test(body));

  check('log-redaction import', /require\(['"]\.\/log-redaction['"]\)/.test(body));



  const fnMatch = body.match(/async\s+checkEligibility\s*\([^)]*\)\s*\{/);

  if (!fnMatch) {

    check('checkEligibility method found', false);

    return;

  }

  const start = fnMatch.index;

  const end = body.indexOf('\n  /**', start + 1);

  const block = end > start ? body.slice(start, end) : body.slice(start, start + 12000);



  check('checkEligibility uses secureLogger', /secureLogger\.(info|warn|error)/.test(block));



  const rawConsole = [...block.matchAll(/\bconsole\.(log|warn|error)\s*\(/g)];

  check('no raw console in checkEligibility', rawConsole.length === 0, rawConsole.length ? `${rawConsole.length} call(s)` : undefined);



  const phiPatterns = [

    { label: 'patientName in logs', re: /console\.(log|warn|error)[\s\S]{0,120}patientName/i },

    { label: 'memberId in logs', re: /console\.(log|warn|error)[\s\S]{0,120}memberId/i },

    { label: 'Patient: literal log', re: /console\.(log|warn|error)\([^)]*['"]Patient:/i },

    { label: 'Member ID: literal log', re: /console\.(log|warn|error)\([^)]*['"]Member ID:/i }

  ];

  for (const p of phiPatterns) {

    check(`no ${p.label}`, !p.re.test(block));

  }

}



function auditPaymentSettlement(filePath, report) {

  function check(name, ok, detail) {

    report.checks.push({ file: filePath, name, ok, detail: detail || null });

    if (!ok) report.pass = false;

    console.log(`${ok ? '✅' : '❌'} [rcm-payment] ${name}${detail ? `: ${detail}` : ''}`);

  }



  if (!fs.existsSync(filePath)) {

    check('rcm-payment-settlement.js exists', false, filePath);

    return;

  }



  const body = fs.readFileSync(filePath, 'utf8');

  const bad = [

    { label: 'console.log patient_id', re: /console\.log[\s\S]{0,80}patient_id/i },

    { label: 'console.log card', re: /console\.log[\s\S]{0,80}client_secret/i }

  ];

  for (const p of bad) {

    check(`no ${p.label}`, !p.re.test(body));

  }

  check('log-redaction module exists', fs.existsSync(path.join(ROOT, 'services/log-redaction.js')));

}



function main() {

  const report = { pass: true, checks: [] };



  console.log('\n=== Log redaction structural audit ===\n');

  auditCheckEligibility(path.join(ROOT, 'services/insurance-service.js'), report);

  console.log('');

  auditPaymentSettlement(path.join(ROOT, 'services/rcm-payment-settlement.js'), report);



  console.log('\n' + JSON.stringify(report, null, 2));

  process.exit(report.pass ? 0 : 1);

}



main();

