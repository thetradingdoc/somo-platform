#!/usr/bin/env node
'use strict';

/**
 * Week 1 gate automation (D1-02, D1-06, D2-04, G-01–G-06 partial).
 * Operator still runs Twilio console + one inbound call for full green.
 *
 * Usage: npm run gate:week1
 * Env: SOMO_OWNER_EMAIL (or local/provider-login.credentials)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const http = require('http');
const https = require('https');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const isStagingGate = process.env.STAGING === '1' || process.env.STAGING === 'true';
const db = isStagingGate ? null : require('../database');

function parseCredentialsFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key === 'email') out.email = val;
  }
  return out;
}

function ownerEmail() {
  const credPath = path.join(__dirname, '..', '..', 'local', 'provider-login.credentials');
  const file = parseCredentialsFile(credPath);
  return (process.env.SOMO_OWNER_EMAIL || file.email || '').trim();
}

function fetchStatus(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  return false;
}

function pass(msg) {
  console.log(`✅ ${msg}`);
  return true;
}

async function main() {
  const isStaging = process.env.STAGING === '1' || process.env.STAGING === 'true';
  console.log(`\n━━━ Somo Week 1 gate${isStaging ? ' (staging)' : ''} ━━━\n`);
  let ok = true;

  if (isStaging) {
    const uiBase = (process.env.UI_BASE_URL || 'https://myskinandcare.com').replace(/\/$/, '');
    const apiBase = (process.env.MIDDLEWARE_API_BASE || 'https://api.myskinandcare.com').replace(/\/$/, '');

    const apiLive = await fetchStatus(`${apiBase}/health/live`);
    ok = (apiLive >= 200 && apiLive < 300 ? pass : fail)(`API /health/live → ${apiLive}`) && ok;

    const signup = await fetchStatus(`${uiBase}/signup`);
    ok = (signup >= 200 && signup < 400 ? pass : fail)(`UI /signup → ${signup}`) && ok;

    const login = await fetchStatus(`${uiBase}/login`);
    ok = (login >= 200 && login < 400 ? pass : fail)(`UI /login → ${login}`) && ok;

    const routing = spawnSync(process.execPath, [path.join(__dirname, 'prod-routing-readiness-smoke.cjs')], {
      stdio: 'inherit',
      env: { ...process.env, UI_BASE_URL: uiBase, MIDDLEWARE_API_BASE: apiBase, SKIP_LANDING_TURN_SMOKE: '1' }
    });
    if (routing.status !== 0) ok = false;

    console.log('\nStaging DB checks require Cloud Run Job or operator SQL — verify owner row manually:');
    console.log('  npm run bootstrap:staging (on staging DB_PATH)');
    console.log('  See docs/deployment/STAGING_SIGNOFF.md\n');

    if (ok) {
      console.log('✅ Staging gate: HTTP checks passed. Complete bootstrap + inbound call for full voice sign-off.\n');
      process.exit(0);
    }
    console.error('❌ Staging gate failed.\n');
    process.exit(1);
  }

  const dbPath = db.sqliteDatabasePath || process.env.DB_PATH || '(unknown)';
  ok = pass(`Database path: ${dbPath}`) && ok;

  const envCheck = spawnSync(process.execPath, [path.join(__dirname, 'verify-voice-env.cjs')], {
    stdio: 'inherit'
  });
  if (envCheck.status !== 0) ok = false;

  const login5180 = await fetchStatus('http://localhost:5180/login');
  if (login5180 === 200) pass('D1-06 / G-04 proxy: http://localhost:5180/login → 200');
  else {
    ok = fail(`D1-06: expected 200 from :5180/login, got ${login5180 || 'unreachable'}`) && ok;
  }

  const login4000 = await fetchStatus('http://localhost:4000/login');
  if (login4000 === 200) pass('Owner login route: http://localhost:4000/login → 200');
  else ok = fail(`V-01 partial: /login on :4000 returned ${login4000 || 'unreachable'}`) && ok;

  const email = ownerEmail();
  if (!email) {
    ok = fail('D2-02: set SOMO_OWNER_EMAIL or local/provider-login.credentials') && ok;
  } else {
    const customer = db.getCustomerByEmail(email);
    if (!customer) {
      ok = fail(`Owner customer not found for ${email} — run npm run ensure:somo-owner`) && ok;
    } else {
      pass(`Owner customer: ${customer.id} (${email})`);
      if (!customer.merchant_id) ok = fail('D2-05: owner missing merchant_id') && ok;
      else pass(`Owner merchant_id: ${customer.merchant_id}`);

      const clinic = db.db
        .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1')
        .get(customer.merchant_id);
      if (!clinic) ok = fail('D2-05: owner missing clinic row') && ok;
      else pass(`Owner clinic_id: ${clinic.clinic_id}`);

      if (!customer.twilio_phone_number) {
        console.warn('⚠️  D3-03: owner twilio_phone_number not set (run attach-existing-twilio-number.cjs)');
      } else pass(`Owner inbound line: ${customer.twilio_phone_number}`);

      if (!customer.retell_agent_id) {
        console.warn('⚠️  D4-01: owner retell_agent_id not set');
      } else pass(`Owner retell_agent_id: ${customer.retell_agent_id}`);

      const recentCall = db.db
        .prepare(
          `SELECT call_id, customer_id FROM voice_call_log
           WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(customer.id);
      if (recentCall) pass(`V-03: recent voice_call_log for owner (${recentCall.call_id})`);
      else console.warn('⚠️  V-02/V-03: no voice_call_log for owner — place one inbound test call');
    }
  }

  console.log('\nOptional: npm run test:e2e:login (requires middleware running)\n');

  if (!process.argv.includes('--skip-e2e')) {
    const e2e = spawnSync('npm', ['run', 'test:e2e:login'], {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..')
    });
    if (e2e.status === 0) pass('G-06: test:e2e:login passed');
    else {
      console.warn('⚠️  G-06: test:e2e:login skipped or failed (start middleware first)');
    }
  }

  console.log('');
  if (ok) {
    console.log('✅ Week 1 gate: repo checks passed. Complete operator steps (Twilio webhook + inbound call) for full V-02/V-03.\n');
    process.exit(0);
  }
  console.error('❌ Week 1 gate: fix failures above.\n');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
