#!/usr/bin/env node
'use strict';

/**
 * Operator sync: Twilio inbound URL, Retell agent WSS, DNS/HTTP checks, optional UI deploy.
 *
 * Usage:
 *   node scripts/callsomo-operator-sync.cjs              # verify + fix Twilio/Retell
 *   node scripts/callsomo-operator-sync.cjs --deploy-ui  # also build + firebase deploy
 *
 * Env (middleware-platform/.env):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *   RETELL_API_KEY, RETELL_AGENT_ID (optional)
 *   API_BASE_URL=https://api.callsomo.com
 *   CALLSOMO_VOICE_CUSTOMER_ID=cust_...  (required if Twilio webhook has no customer_id)
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'middleware-platform');

require(path.join(MP, 'node_modules', 'dotenv')).config({ path: path.join(MP, '.env') });

const API_BASE = (process.env.API_BASE_URL || process.env.BASE_URL || 'https://api.callsomo.com').replace(
  /\/+$/,
  ''
);
const UI_BASE = (process.env.UI_BASE_URL || 'https://callsomo.com').replace(/\/+$/, '');
const LLM_WS =
  process.env.RETELL_LLM_WEBSOCKET_URL ||
  API_BASE.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/webhook/retell/llm';
const AGENT_ID = process.env.RETELL_AGENT_ID || 'agent_85c66c32dec5575db0ed066130';
const TWILIO_SID =
  process.env.STAGING_OWNER_TWILIO_SID ||
  process.env.TWILIO_PHONE_SID ||
  'PNa74666cb828d4fa385df5d74292fd18e';
const DEFAULT_TWILIO_NUMBER = '+13639990205';
const FIREBASE_PROJECT = process.env.FIREBASE_HOSTING_PROJECT || 'somo-4ddf6';

const shouldDeployUi = process.argv.includes('--deploy-ui');

function ok(msg) {
  console.log(`OK  ${msg}`);
}
function warn(msg) {
  console.warn(`WARN ${msg}`);
}
function fail(msg) {
  console.error(`FAIL ${msg}`);
}

function extractCustomerId(voiceUrl) {
  if (!voiceUrl) return null;
  const m = String(voiceUrl).match(/customer_id=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

async function httpStatus(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

function digShort(name, type = 'A') {
  try {
    return execSync(`dig +short ${name} ${type} @8.8.8.8`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
  } catch {
    return '';
  }
}

async function syncTwilio(customerId) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    warn('Twilio credentials missing — skip voice URL update');
    return false;
  }
  if (!TWILIO_SID) {
    warn('TWILIO_PHONE_SID / STAGING_OWNER_TWILIO_SID missing — skip');
    return false;
  }
  if (!customerId) {
    fail('CALLSOMO_OPERATOR_CUSTOMER_ID or CALLSOMO_VOICE_CUSTOMER_ID required (or existing Twilio URL must include customer_id)');
    return false;
  }

  const twilio = require(path.join(MP, 'node_modules', 'twilio'))(sid, token);
  const numbers = await twilio.incomingPhoneNumbers.list({ limit: 20 });
  const target =
    numbers.find((n) => n.sid === TWILIO_SID) ||
    numbers.find((n) => n.phoneNumber === DEFAULT_TWILIO_NUMBER) ||
    numbers[0];
  if (!target) {
    fail('No Twilio incoming numbers found');
    return false;
  }

  const voiceUrl = `${API_BASE}/voice/incoming?customer_id=${encodeURIComponent(customerId)}`;
  const statusCallback = `${API_BASE}/voice/status-callback`;
  const current = target.voiceUrl || '';
  const currentStatus = (target.statusCallback || '').replace(/\/+$/, '');
  const voiceOk = current === voiceUrl;
  const statusOk = currentStatus === statusCallback;

  if (voiceOk && statusOk) {
    ok(`Twilio ${target.phoneNumber} voice URL + statusCallback already correct`);
    return true;
  }

  const patch = { voiceMethod: 'POST' };
  if (!voiceOk) {
    patch.voiceUrl = voiceUrl;
  }
  if (!statusOk) {
    patch.statusCallback = statusCallback;
    patch.statusCallbackMethod = 'POST';
  }

  const updated = await twilio.incomingPhoneNumbers(target.sid).update(patch);
  ok(`Twilio ${updated.phoneNumber} voice URL → ${updated.voiceUrl}`);
  if (!statusOk) {
    ok(`Twilio ${updated.phoneNumber} statusCallback → ${updated.statusCallback}`);
  }
  if (updated.recordingStatusCallback) {
    warn(`recordingStatusCallback=${updated.recordingStatusCallback} (not auto-updated)`);
  }
  return true;
}

async function verifyRetellAgent(agentId) {
  if (!process.env.RETELL_API_KEY) {
    warn('RETELL_API_KEY missing — skip Retell agent verify');
    return false;
  }
  if (!agentId) {
    fail('No Retell agent ID (RETELL_AGENT_ID or operator row)');
    return false;
  }
  const RetellService = require(path.join(MP, 'services', 'retell-service'));
  const svc = new RetellService();
  const result = await svc.getAgent(agentId);
  if (result.success) {
    ok(`Retell agent ${agentId} exists`);
    return true;
  }
  fail(`Retell agent ${agentId}: ${result.error}`);
  return false;
}

function isLocalCallback(url) {
  return url && /ngrok|localhost|127\.0\.0\.1/i.test(String(url));
}

async function auditTwilioCallbacks(target) {
  for (const [label, url] of [
    ['voiceUrl', target.voiceUrl],
    ['statusCallback', target.statusCallback],
    ['voiceFallbackUrl', target.voiceFallbackUrl],
    ['recordingStatusCallback', target.recordingStatusCallback]
  ]) {
    if (isLocalCallback(url)) {
      fail(`${label} points to local/ngrok: ${url}`);
    }
  }
}

function syncRetell() {
  if (!process.env.RETELL_API_KEY) {
    warn('RETELL_API_KEY missing — skip configure-retell');
    return false;
  }
  const env = {
    ...process.env,
    API_BASE_URL: API_BASE,
    BASE_URL: API_BASE,
    RETELL_LLM_WEBSOCKET_URL: LLM_WS,
    RETELL_AGENT_ID: AGENT_ID,
    NODE_ENV: 'production',
  };
  const r = spawnSync(process.execPath, ['configure-retell.js'], {
    cwd: MP,
    env,
    stdio: 'inherit',
  });
  return r.status === 0;
}

async function checkDnsAndHttp() {
  console.log('\n==> DNS (Google 8.8.8.8)');
  const apex = digShort('callsomo.com', 'A');
  const api = digShort('api.callsomo.com', 'CNAME') || digShort('api.callsomo.com', 'A');
  // Legacy domain retirement verification (should 301 to callsomo.com)
  const myskin = digShort('myskinandcare.com', 'A');
  console.log(`  callsomo.com A: ${apex || '(none)'}`);
  console.log(`  api.callsomo.com: ${api || '(none)'}`);
  console.log(`  myskinandcare.com A: ${myskin || '(none)'}`);

  console.log('\n==> HTTP');
  const apiLive = await httpStatus(`${API_BASE}/health/live`);
  const uiLogin = await httpStatus(`${UI_BASE}/login`);
  const myskinUi = await httpStatus('https://myskinandcare.com/');
  console.log(`  ${API_BASE}/health/live → ${apiLive || 'error'}`);
  console.log(`  ${UI_BASE}/login → ${uiLogin || 'error'}`);
  console.log(`  https://myskinandcare.com/ → ${myskinUi || 'error'} (expect 301 at registrar when cutover done)`);

  if (apiLive !== 200) fail('API health check failed');
  else ok('API reachable');

  if (uiLogin !== 200) {
    warn('callsomo.com UI not 200 — finish Firebase custom domain + deploy UI');
  } else ok('callsomo.com UI reachable');

  if (myskinUi === 200) {
    warn('myskinandcare.com still serves content — add 301 to callsomo.com at Squarespace/registrar');
  }

  const txt = digShort('callsomo.com', 'TXT');
  if (txt && !txt.includes('hosting-site=somo-4ddf6')) {
    warn('Firebase hosting-site TXT not visible on callsomo.com');
  } else if (txt.includes('hosting-site')) {
    ok('Firebase hosting TXT present');
  }
}

function runDeployUi() {
  console.log('\n==> Deploy UI (Firebase ' + FIREBASE_PROJECT + ')');
  execSync(`VITE_API_BASE=${API_BASE} npm run build:staging-hosting`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  execSync(`npx firebase-tools deploy --only hosting:${FIREBASE_PROJECT} --project ${FIREBASE_PROJECT}`, {
    cwd: path.join(ROOT, 'unified-dashboard'),
    stdio: 'inherit',
  });
  ok('Firebase hosting deploy finished');
}

async function main() {
  console.log('callsomo operator sync');
  console.log(`  API: ${API_BASE}`);
  console.log(`  WSS: ${LLM_WS}`);
  console.log(`  Agent: ${AGENT_ID}\n`);

  let customerId = process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
    process.env.CALLSOMO_VOICE_CUSTOMER_ID ||
    process.env.STAGING_OWNER_CUSTOMER_ID;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (sid && token && TWILIO_SID) {
    const twilio = require(path.join(MP, 'node_modules', 'twilio'))(sid, token);
    const n = await twilio.incomingPhoneNumbers(TWILIO_SID).fetch();
    customerId = customerId || extractCustomerId(n.voiceUrl);
    console.log(`Twilio number: ${n.phoneNumber}`);
    console.log(`Current voice URL: ${n.voiceUrl || '(unset)'}\n`);
  }

  await checkDnsAndHttp();

  console.log('\n==> Twilio');
  await syncTwilio(customerId);
  if (sid && token && TWILIO_SID) {
    const twilio = require(path.join(MP, 'node_modules', 'twilio'))(sid, token);
    const n = await twilio.incomingPhoneNumbers(TWILIO_SID).fetch();
    await auditTwilioCallbacks(n);
  }

  console.log('\n==> Retell');
  syncRetell();
  const agentId = process.env.RETELL_AGENT_ID || process.env.RETELL_SALES_AGENT_ID || AGENT_ID;
  await verifyRetellAgent(agentId);

  if (shouldDeployUi) {
    runDeployUi();
    await checkDnsAndHttp();
  } else {
    console.log('\nTip: npm run callsomo:operator-sync -- --deploy-ui');
  }

  console.log('\n==> Manual (registrar)');
  console.log('  Squarespace: 301 redirect myskinandcare.com → https://callsomo.com');
  console.log('  Optional: api.myskinandcare.com → https://api.callsomo.com');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
