#!/usr/bin/env node
'use strict';

/**
 * Sandbox report: signup → SIM trial → Twilio number (code + config check).
 * Does not call Twilio purchase APIs unless SANDBOX_LIVE_TWILIO=1.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO = path.join(__dirname, '..', '..');
const MP = path.join(REPO, 'middleware-platform');
const WIP = path.join(REPO, '.sandbox-trial', 'middleware-platform');
const LOG_PATH = path.join(REPO, '.cursor', 'debug-b1a7cd.log');

function agentLog(hypothesisId, location, message, data) {
  const line = JSON.stringify({
    sessionId: 'b1a7cd',
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
    runId: process.env.SANDBOX_RUN_ID || 'sandbox-report'
  });
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (_) {}
}

function envSet(name) {
  try {
    const p = path.join(MP, '.env');
    if (!fs.existsSync(p)) return false;
    const line = fs.readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
    if (!line) return false;
    const v = line.split('=').slice(1).join('=').trim();
    return v.length > 0 && v !== '0' && v !== 'false';
  } catch {
    return false;
  }
}

function fileExists(rel) {
  return fs.existsSync(path.join(MP, rel));
}

function httpGet(urlPath) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:4000${urlPath}`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 200) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'timeout' });
    });
  });
}

async function main() {
  const report = {
    branch: null,
    onCurrentTree: {},
    onWipTree: {},
    runtime: {},
    verdict: null
  };

  try {
    const { execSync } = require('child_process');
    report.branch = execSync('git branch --show-current', { cwd: REPO, encoding: 'utf8' }).trim();
  } catch (_) {}

  report.onCurrentTree = {
    trial_lifecycle: fileExists('services/trial-lifecycle.js'),
    twilio_verify_service: fileExists('services/twilio-verify-service.js'),
    verify_phone_routes: false,
    assign_line_route: false,
    signup_session_route: false
  };
  try {
    const signup = fs.readFileSync(path.join(MP, 'routes/signup-trial.js'), 'utf8');
    report.onCurrentTree.verify_phone_routes = signup.includes('/signup/verify-phone/send');
    report.onCurrentTree.assign_line_route = signup.includes('/signup/assign-line');
    report.onCurrentTree.signup_session_route = signup.includes("router.get('/signup/session'");
  } catch (_) {}

  report.onWipTree = {
    trial_lifecycle: fs.existsSync(path.join(WIP, 'services/trial-lifecycle.js')),
    twilio_verify_service: fs.existsSync(path.join(WIP, 'services/twilio-verify-service.js')),
    verify_phone_routes: false,
    assign_line_route: false,
    phone_step_signup_html: false
  };
  try {
    const signupWip = fs.readFileSync(path.join(WIP, 'routes/signup-trial.js'), 'utf8');
    report.onWipTree.verify_phone_routes = signupWip.includes('/signup/verify-phone/send');
    report.onWipTree.assign_line_route = signupWip.includes('/signup/assign-line');
    const html = fs.readFileSync(path.join(WIP, '../unified-dashboard/signup.html'), 'utf8');
    report.onWipTree.phone_step_signup_html = html.includes('signupAssignLoading');
  } catch (_) {}

  report.env = {
    TRIAL_SIM_FLOW_ENABLED: envSet('TRIAL_SIM_FLOW_ENABLED'),
    TRIAL_DEFAULT_AREA_CODE: envSet('TRIAL_DEFAULT_AREA_CODE'),
    TWILIO_VERIFY_SERVICE_SID: envSet('TWILIO_VERIFY_SERVICE_SID'),
    TWILIO_ACCOUNT_SID: envSet('TWILIO_ACCOUNT_SID'),
    TWILIO_AUTH_TOKEN: envSet('TWILIO_AUTH_TOKEN')
  };

  agentLog('A', 'sandbox-trial-signup-report.cjs', 'code presence', {
    branch: report.branch,
    current: report.onCurrentTree,
    wip: report.onWipTree,
    env: report.env
  });

  const signupGet = await httpGet('/signup');
  const sessionGet = await httpGet('/api/signup/session');
  report.runtime = {
    signupGet,
    sessionGet,
    verifyPhoneOnRunningServer: null,
    assignLineOnRunningServer: null
  };

  const postOpts = {
    hostname: '127.0.0.1',
    port: 4000,
    path: '/api/signup/assign-line',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };
  report.runtime.assignLineOnRunningServer = await new Promise((resolve) => {
    const req = http.request(postOpts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 120) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(JSON.stringify({ phone_number: '+15555550123' }));
    req.end();
  });

  const legacyPostOpts = {
    hostname: '127.0.0.1',
    port: 4000,
    path: '/api/signup/verify-phone/send',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };
  report.runtime.verifyPhoneOnRunningServer = await new Promise((resolve) => {
    const req = http.request(legacyPostOpts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 120) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(JSON.stringify({ phone_number: '+15555550123' }));
    req.end();
  });

  agentLog('B', 'sandbox-trial-signup-report.cjs', 'runtime probes', report.runtime);

  if (report.onWipTree.trial_lifecycle && report.onWipTree.verify_phone_routes && report.onWipTree.phone_step_signup_html) {
    if (!report.onCurrentTree.trial_lifecycle || !report.onCurrentTree.verify_phone_routes) {
      report.verdict =
        'BUILT on wip/split-source (PR #18) but NOT on your current branch/server. Restart on wip or merge PR #18.';
    } else if (!report.env.TRIAL_SIM_FLOW_ENABLED) {
      report.verdict =
        'Code present but TRIAL_SIM_FLOW_ENABLED is off in .env — SIM phone step and startTrialTenant() will not run.';
    } else {
      report.verdict =
        'Code and flags look present. Run: node scripts/trial-provision-smoke.cjs (requires server + TRIAL_SIM_FLOW_ENABLED=1).';
    }
  } else {
    report.verdict = 'SIM trial pipeline incomplete on current tree — merge feat/voice-billing-dodgecall-trial.';
  }

  if (report.runtime.assignLineOnRunningServer?.status === 404) {
    report.verdict += ' Running server returns 404 on assign-line — restart server on current branch.';
  } else if (report.runtime.assignLineOnRunningServer?.status === 401) {
    report.verdict += ' assign-line route exists (401 without session is expected).';
  }

  agentLog('C', 'sandbox-trial-signup-report.cjs', 'verdict', { verdict: report.verdict });

  console.log(JSON.stringify(report, null, 2));
  console.log('\nVERDICT:', report.verdict);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
