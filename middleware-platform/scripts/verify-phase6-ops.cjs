#!/usr/bin/env node

'use strict';



/**

 * Phase 6 ops readiness gate — rate limits, log redaction, deploy/compliance artifacts.

 * Usage: node scripts/verify-phase6-ops.cjs

 */



const fs = require('fs');

const path = require('path');

const { spawnSync } = require('child_process');



const ROOT = path.join(__dirname, '..');

const REPO_ROOT = path.join(ROOT, '..');



function check(name, ok, detail) {

  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);

  return ok;

}



function fileContains(filePath, needle) {

  if (!fs.existsSync(filePath)) return false;

  return fs.readFileSync(filePath, 'utf8').includes(needle);

}



function main() {

  console.log('\n=== Phase 6 Ops Gate ===\n');

  let pass = true;



  const pilotRateLimit = path.join(ROOT, 'middleware/pilot-rate-limit.js');
  pass = check('pilot-rate-limit.js exists', fs.existsSync(pilotRateLimit)) && pass;
  pass = check('pilot-rate-limit exports pilotRateLimit', fileContains(pilotRateLimit, 'pilotRateLimit')) && pass;

  const rosterRoute = path.join(ROOT, 'routes/tenant-roster.js');
  pass = check('tenant-roster import uses pilotRateLimit', fileContains(rosterRoute, "pilotRateLimit('roster_import')")) && pass;

  const inviteRoute = path.join(ROOT, 'routes/provider-invites.js');
  pass =
    check('provider-invites uses pilotRateLimit', fileContains(inviteRoute, "pilotRateLimit('invite_accept')")) && pass;



  pass =

    check(

      'FRONT_DESK_DEPLOY_CHECKLIST.md exists',

      fs.existsSync(path.join(REPO_ROOT, 'docs/deployment/FRONT_DESK_DEPLOY_CHECKLIST.md'))

    ) && pass;



  pass =

    check(

      'PHI_BOUNDARY_DIAGRAM.md exists',

      fs.existsSync(path.join(REPO_ROOT, 'docs/compliance/PHI_BOUNDARY_DIAGRAM.md'))

    ) && pass;



  pass =

    check(

      'pilot-scenario-matrix.md exists',

      fs.existsSync(path.join(REPO_ROOT, 'docs/voice-agent/pilot-scenario-matrix.md'))

    ) && pass;



  pass =

    check(

      'PILOT_ONCALL_WEEK.md exists',

      fs.existsSync(path.join(REPO_ROOT, 'docs/voice-agent/PILOT_ONCALL_WEEK.md'))

    ) && pass;



  pass =

    check(

      'SECRETS_ROTATION runbook exists',

      fs.existsSync(path.join(REPO_ROOT, 'docs/runbooks/SECRETS_ROTATION.md'))

    ) && pass;



  pass =

    check(

      'backup-drill-checklist.cjs exists',

      fs.existsSync(path.join(ROOT, 'scripts/backup-drill-checklist.cjs'))

    ) && pass;



  pass =

    check(

      'report-front-desk-ops.cjs exists',

      fs.existsSync(path.join(ROOT, 'scripts/report-front-desk-ops.cjs'))

    ) && pass;



  const deploySh = path.join(REPO_ROOT, 'scripts/deploy-to-gcp.sh');

  pass = check('Cloud Run max-instances=1 in deploy script', fileContains(deploySh, 'CLOUDRUN_MAX_INSTANCES:-1')) && pass;



  const shellJs = path.join(REPO_ROOT, 'unified-dashboard/assets/js/provider-shell.js');

  pass = check('dental nav hides Revenue', fileContains(shellJs, "__SOMO_DENTAL_PORTAL")) && pass;



  console.log('\n── verify:log-redaction ──');

  const redaction = spawnSync(process.execPath, ['scripts/verify-log-redaction.cjs'], {

    cwd: ROOT,

    encoding: 'utf8',

    stdio: 'inherit'

  });

  pass = check('verify-log-redaction passes', redaction.status === 0) && pass;



  console.log('\n── verify:pilot-scenario-matrix ──');

  const matrix = spawnSync(process.execPath, ['scripts/verify-pilot-scenario-matrix.cjs'], {

    cwd: ROOT,

    encoding: 'utf8',

    stdio: 'inherit'

  });

  pass = check('verify-pilot-scenario-matrix passes', matrix.status === 0) && pass;



  console.log('\n' + JSON.stringify({ pass }, null, 2));

  process.exit(pass ? 0 : 1);

}



main();

