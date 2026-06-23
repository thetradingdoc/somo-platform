#!/usr/bin/env node
'use strict';

/**
 * Production capstone — register Retell phone call + drive Kelly via LLM WebSocket on api.callsomo.com.
 * After the session: flush Cloud Run SQLite to GCS, pull DB, run verify-live-call.cjs.
 *
 * Usage:
 *   node scripts/capstone-retell-live-verify.cjs
 *   node scripts/capstone-retell-live-verify.cjs --skip-preseed --skip-flush
 *   node scripts/capstone-retell-live-verify.cjs --session_id=call_xxx --verify-only
 */

const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const axios = require('axios');
const WebSocket = require('ws');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MP = path.join(__dirname, '..');
const API_BASE = process.env.CAPSTONE_API_BASE || 'https://api.callsomo.com';
const API_WS = process.env.CAPSTONE_API_WS || 'wss://api.callsomo.com/webhook/retell/llm';
const GCS_BUCKET = process.env.GCS_DB_BUCKET || 'somo-staging-db-somo-callsomo';
const GCS_OBJECT = process.env.GCS_DB_OBJECT || 'middleware-staging.db';
const TURN_DELAY_MS = parseInt(process.env.CAPSTONE_TURN_DELAY_MS || '22000', 10);
const POST_AGENT_SETTLE_MS = parseInt(process.env.CAPSTONE_POST_AGENT_SETTLE_MS || '6000', 10);
const CAPSTONE_DB_TOKEN = process.env.CAPSTONE_DB_SYNC_TOKEN || process.env.RETELL_WEBHOOK_TOKEN || '';

const AGENT_ID = process.env.RETELL_AGENT_ID;
const RETELL_KEY = process.env.RETELL_API_KEY;
const CUSTOMER_ID = process.env.CAPSTONE_CUSTOMER_ID || process.env.CALLSOMO_OPERATOR_CUSTOMER_ID;
const CLINIC_ID = process.env.CAPSTONE_CLINIC_ID || process.env.DEFAULT_CLINIC_ID || 'clinic-default';
const FROM_NUMBER = process.env.CAPSTONE_FROM_NUMBER || '+12028131474';
const TO_NUMBER = process.env.CAPSTONE_TENANT_DID || '+18622307479';

const UTTERANCES = [
  'Hi, I have stomach pain since this morning.',
  'It started this morning.',
  'It feels like an aching pain.',
  'It is constant.',
  'About a six out of ten.',
  'No medications.',
  'No allergies.',
  'No prior tests.',
  'No alcohol use.',
  'I have Blue Cross Blue Shield plan x.',
  'My member id is MBR123.',
  'Yes please book an appointment.',
  'Paul Capstone.',
  'paul.capstone@test.com',
  'plus one two zero two eight one three one four seven four.',
  'Thank you, goodbye.'
];

const RESPONSE_BY_AGENT = [
  { re: /when did|when .* start|start/i, text: 'It started this morning.' },
  { re: /feel like|describe|quality|what .* feel/i, text: 'It feels like an aching pain.' },
  { re: /constant|comes and go|timing|come and go/i, text: 'It is constant.' },
  { re: /scale|1 to 10|how bad|severity|how severe/i, text: 'About a six out of ten.' },
  { re: /medications|meds|taking any/i, text: 'No medications.' },
  { re: /allerg/i, text: 'No allergies.' },
  { re: /prior tests|workups|tests before/i, text: 'No prior tests.' },
  { re: /alcohol|drink/i, text: 'No alcohol use.' },
  { re: /insurance|payer|plan|coverage/i, text: 'I have Blue Cross Blue Shield plan x.' },
  { re: /member id|subscriber|policy number/i, text: 'My member id is MBR123.' },
  { re: /book|appointment|schedule|slot|available/i, text: 'Yes please book an appointment.' },
  { re: /name|full name|who am i speaking/i, text: 'Paul Capstone.' },
  { re: /email|e-mail/i, text: 'paul.capstone@test.com' },
  { re: /phone|number|call you back/i, text: 'plus one two zero two eight one three one four seven four.' }
];

function pickUserReply(agentText, utterIdx) {
  const t = String(agentText || '').toLowerCase();
  for (const row of RESPONSE_BY_AGENT) {
    if (row.re.test(t)) return row.text;
  }
  if (utterIdx < UTTERANCES.length) return UTTERANCES[utterIdx];
  return 'Thank you, goodbye.';
}

const verifyOnly = process.argv.includes('--verify-only');
const skipFlush = process.argv.includes('--skip-flush');
const skipPreseed = process.argv.includes('--skip-preseed');
const sessionArg = (process.argv.find((a) => a.startsWith('--session_id=')) || '').split('=')[1];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function countKellyEvents(dbPath, sessionId) {
  try {
    const integrity = execSync(`sqlite3 "${dbPath}" "PRAGMA integrity_check;"`, {
      encoding: 'utf8',
      shell: '/bin/bash'
    }).trim();
    if (integrity !== 'ok') {
      console.warn(`==> DB integrity failed for ${dbPath}: ${integrity.slice(0, 80)}`);
      return 0;
    }
    const out = execSync(
      `sqlite3 "${dbPath}" "SELECT COUNT(*) FROM kelly_call_events WHERE session_id='${sessionId}'"`,
      { encoding: 'utf8', shell: '/bin/bash' }
    ).trim();
    return parseInt(out, 10) || 0;
  } catch (_) {
    return 0;
  }
}

async function flushLiveDbToGcs(label = 'POST_CALL') {
  if (CAPSTONE_DB_TOKEN) {
    console.log(`==> HTTP flush live DB to GCS (${label})…`);
    try {
      const res = await axios.post(
        `${API_BASE}/api/internal/capstone/db-upload`,
        {},
        {
          headers: { 'X-Capstone-Token': CAPSTONE_DB_TOKEN },
          timeout: 90000
        }
      );
      if (res.data?.success) {
        console.log('==> HTTP DB flush OK');
        return;
      }
      console.warn('==> HTTP DB flush unexpected response:', res.data);
    } catch (e) {
      console.warn('==> HTTP DB flush failed:', e.response?.data || e.message);
    }
  } else {
    console.warn('==> CAPSTONE_DB_SYNC_TOKEN unset — using rolling restart flush');
  }
  rollingRestart(label);
}

async function waitForSessionInGcs(sessionId, attempts = 4) {
  const pulled = path.join(MP, 'backups', 'middleware-staging-capstone.db');
  for (let i = 1; i <= attempts; i++) {
    pullGcsDb(pulled);
    const n = countKellyEvents(pulled, sessionId);
    console.log(`==> GCS pull attempt ${i}/${attempts}: ${n} Kelly events for ${sessionId}`);
    if (n > 0) return true;
    if (i < attempts) {
      await sleep(15000);
      await flushLiveDbToGcs(`RETRY_FLUSH_${i}`);
    }
  }
  return false;
}

function rollingRestart(label) {
  console.log(`==> Rolling Cloud Run (${label})…`);
  const stamp = String(Date.now());
  execSync(
    `gcloud run services update somo-middleware --region us-central1 --project somo-callsomo --update-env-vars CAPSTONE_${label}=${stamp}`,
    { stdio: 'inherit' }
  );
  console.log('==> Waiting 90s for instance cycle…');
  execSync('sleep 90');
}

function dbIntegrityOk(dbPath) {
  try {
    const out = execSync(`sqlite3 "${dbPath}" "PRAGMA integrity_check;"`, {
      encoding: 'utf8',
      shell: '/bin/bash'
    }).trim();
    return out === 'ok';
  } catch (_) {
    return false;
  }
}

async function preseedCloudDb() {
  const seedPath = path.join(MP, 'backups', 'seed-upload.db');
  const fallbacks = [
    path.join(MP, 'backups', 'middleware-staging-fresh.db'),
    path.join(MP, 'backups', 'run8-gcs.db'),
    path.join(MP, 'backups', 'gcs-fresh-now.db')
  ];
  console.log('==> Pre-seed GCS DB (clinic DID + bookable provider + payer rules)');
  try {
    execSync(`GCS_DB_BUCKET=${GCS_BUCKET} DB_PATH="${seedPath}" node scripts/cloudrun-db-sync.cjs download`, {
      cwd: MP,
      stdio: 'inherit',
      shell: '/bin/bash'
    });
  } catch (_) {}

  if (!fs.existsSync(seedPath) || !dbIntegrityOk(seedPath)) {
    const fallback = fallbacks.find((p) => fs.existsSync(p) && dbIntegrityOk(p));
    if (!fallback) throw new Error('No intact local DB fallback for GCS preseed');
    console.warn(`==> GCS DB corrupt or missing — seeding from ${path.basename(fallback)}`);
    fs.copyFileSync(fallback, seedPath);
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(seedPath + suffix); } catch (_) {}
    }
  }

  execSync(`DB_PATH="${seedPath}" CALLSOMO_OPERATOR_CUSTOMER_ID=${CUSTOMER_ID} SOMO_OWNER_EMAIL=${process.env.SOMO_OWNER_EMAIL || 'richard@callsomo.com'} node scripts/seed-operator-customer.cjs`, {
    cwd: MP,
    stdio: 'inherit',
    shell: '/bin/bash'
  });

  const {
    stampTenantSiteContext,
    assertSiteContextVerdict
  } = require('./lib/stamp-tenant-site-context.cjs');
  stampTenantSiteContext(seedPath, {
    customerId: CUSTOMER_ID,
    clinicId: CLINIC_ID,
    did: TO_NUMBER
  });
  assertSiteContextVerdict(seedPath, {
    customerId: CUSTOMER_ID,
    clinicId: CLINIC_ID,
    did: TO_NUMBER
  });
  console.log('==> Tenant site-context verified (merchant bind + DID)');

  process.env.DB_PATH = seedPath;
  const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');
  fixtures.seedE2eBookableProvider(CLINIC_ID, {
    specialty: 'Gastroenterology',
    providerEmail: 'maria.santos@doclittle.example'
  });
  spawnSync('node', ['seeds/pilot-payer-rules.js'], { cwd: MP, stdio: 'pipe', env: { ...process.env, DB_PATH: seedPath } });

  execSync(`GCS_DB_BUCKET=${GCS_BUCKET} DB_PATH="${seedPath}" GCS_DB_UPLOAD_FORCE=1 node scripts/cloudrun-db-sync.cjs upload`, {
    cwd: MP,
    stdio: 'inherit',
    shell: '/bin/bash'
  });
  rollingRestart('PRESEED');
}

async function registerCall() {
  if (!RETELL_KEY || !AGENT_ID) throw new Error('RETELL_API_KEY and RETELL_AGENT_ID required');
  if (!CUSTOMER_ID) throw new Error('CALLSOMO_OPERATOR_CUSTOMER_ID required');

  const meta = {
    call_type: 'tenant',
    direction: 'inbound',
    customer_id: CUSTOMER_ID,
    clinic_id: CLINIC_ID,
    site_context_status: 'verified',
    clinic_id_source: 'did',
    routing_world: 'tenant'
  };

  const res = await axios.post(
    'https://api.retellai.com/v2/register-phone-call',
    {
      agent_id: AGENT_ID,
      audio_websocket_protocol: 'twilio',
      audio_encoding: 'mulaw',
      sample_rate: 8000,
      from_number: FROM_NUMBER,
      to_number: TO_NUMBER,
      metadata: meta,
      retell_llm_dynamic_variables: meta
    },
    {
      headers: { Authorization: `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000
    }
  );
  return res.data.call_id;
}

async function driveWebSocket(callId) {
  const wsUrl = `${API_WS.replace(/\/$/, '')}/${callId}`;
  console.log('==> WebSocket', wsUrl);

  const transcript = [];
  let responseId = 0;
  let utterIdx = 0;
  let agentTurns = 0;
  let userTurnTimer = null;
  let closed = false;
  let lastScheduledAgentTurn = 0;

  const meta = {
    call_type: 'tenant',
    direction: 'inbound',
    customer_id: CUSTOMER_ID,
    clinic_id: CLINIC_ID,
    site_context_status: 'verified',
    clinic_id_source: 'did',
    routing_world: 'tenant'
  };

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: { 'x-retell-call-id': callId } });
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error('Capstone WS timeout (20m)'));
    }, 20 * 60 * 1000);

  let lastAgentText = '';

    const scheduleUserTurn = () => {
      if (userTurnTimer) clearTimeout(userTurnTimer);
      if (utterIdx >= UTTERANCES.length + 4) {
        userTurnTimer = setTimeout(() => { if (!closed) ws.close(); }, 4000);
        return;
      }
      userTurnTimer = setTimeout(() => {
        if (closed) return;
        const content = pickUserReply(lastAgentText, utterIdx);
        utterIdx += 1;
        transcript.push({ role: 'user', content });
        responseId += 1;
        console.log(`>> user: ${content}`);
        ws.send(JSON.stringify({
          interaction_type: 'response_required',
          response_id: responseId,
          transcript: [...transcript]
        }));
      }, POST_AGENT_SETTLE_MS + TURN_DELAY_MS);
    };

    ws.on('open', () => {
      console.log('==> WS open — sending call_details');
      ws.send(JSON.stringify({
        interaction_type: 'call_details',
        call_id: callId,
        from_number: FROM_NUMBER,
        to_number: TO_NUMBER,
        agent_id: AGENT_ID,
        call_type: 'phone_call',
        metadata: meta,
        dynamic_variables: meta,
        retell_llm_dynamic_variables: meta
      }));
      setTimeout(() => {
        responseId = 1;
        ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: responseId, transcript: [] }));
      }, 2000);
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch (_) { return; }

      if (msg.interaction_type === 'ping_pong' || msg.response_type === 'ping_pong') {
        ws.send(JSON.stringify({ response_type: 'ping_pong', timestamp: msg.timestamp || Date.now() }));
        return;
      }

      if (msg.response_type === 'response' && msg.content && msg.content_complete !== false) {
        agentTurns += 1;
        lastAgentText = String(msg.content || '');
        transcript.push({ role: 'agent', content: msg.content });
        console.log(`<< agent: ${String(msg.content).slice(0, 140)}${msg.content.length > 140 ? '…' : ''}`);
        if (msg.end_call) {
          setTimeout(() => { if (!closed) ws.close(); }, 800);
          return;
        }
        if (agentTurns !== lastScheduledAgentTurn) {
          lastScheduledAgentTurn = agentTurns;
          scheduleUserTurn();
        }
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timeout);
      if (userTurnTimer) clearTimeout(userTurnTimer);
      reject(e);
    });

    ws.on('close', () => {
      closed = true;
      clearTimeout(timeout);
      if (userTurnTimer) clearTimeout(userTurnTimer);
      console.log(`==> WS closed (agent turns: ${agentTurns}, user turns: ${utterIdx})`);
      resolve({ callId, agentTurns, userTurns: utterIdx });
    });
  });
}

function runVerify(sessionId) {
  const destDb = path.join(MP, 'var', 'db', 'middleware-dev.db');
  const pulled = path.join(MP, 'backups', 'middleware-staging-capstone.db');
  pullGcsDb(pulled);
  const eventCount = countKellyEvents(pulled, sessionId);
  if (eventCount === 0) {
    throw new Error(`No Kelly events in GCS for ${sessionId} — flush did not capture call data`);
  }
  fs.mkdirSync(path.dirname(destDb), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(destDb + suffix); } catch (_) {}
  }
  fs.copyFileSync(pulled, destDb);

  const evidenceDir = path.join(MP, 'var', 'evidence', 'phase1');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const outPath = path.join(evidenceDir, `live_${sessionId}.json`);
  const out = execSync(`node scripts/verify-live-call.cjs --session_id=${sessionId} --json`, {
    cwd: MP,
    encoding: 'utf8',
    env: { ...process.env, DB_PATH: './var/db/middleware-dev.db', SKIP_STARTUP_MIGRATIONS: '1' }
  });
  fs.writeFileSync(outPath, out);
  console.log(out);
  const parsed = JSON.parse(out);
  if (!parsed.success) process.exit(2);
}

function pullGcsDb(dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execSync(`gsutil cp gs://${GCS_BUCKET}/${GCS_OBJECT} "${dest}"`, { stdio: 'inherit' });
}

function assertCapstoneTenantPreflight() {
  if (!CUSTOMER_ID) throw new Error('CALLSOMO_OPERATOR_CUSTOMER_ID required for tenant pre-flight');
  console.log('==> Capstone pre-flight: verify tenant site-context on live GCS');
  execSync('node scripts/verify-tenant-site-context.cjs', {
    cwd: MP,
    stdio: 'inherit',
    env: {
      ...process.env,
      GCS_DB_BUCKET: GCS_BUCKET,
      GCS_DB_OBJECT: GCS_OBJECT,
      CALLSOMO_OPERATOR_CUSTOMER_ID: CUSTOMER_ID,
      CAPSTONE_CLINIC_ID: CLINIC_ID,
      CAPSTONE_TENANT_DID: TO_NUMBER
    }
  });
}

async function main() {
  if (verifyOnly && sessionArg) {
    if (!skipFlush) await flushLiveDbToGcs('VERIFY_FLUSH');
    await waitForSessionInGcs(sessionArg, 3);
    runVerify(sessionArg);
    return;
  }

  if (!skipPreseed) await preseedCloudDb();
  else assertCapstoneTenantPreflight();

  const callId = await registerCall();
  console.log('==> Registered Retell call', callId);
  const wsResult = await driveWebSocket(callId);
  if (wsResult.userTurns < UTTERANCES.length - 1) {
    console.warn(`==> WS ended early (${wsResult.userTurns}/${UTTERANCES.length} user turns)`);
  }
  console.log('==> Call complete — waiting 45s for DB writes…');
  await sleep(45000);

  if (!skipFlush) await flushLiveDbToGcs('POST_CALL_FLUSH');
  await waitForSessionInGcs(callId, 4);
  runVerify(callId);
  console.log('✅ Capstone verify-live-call passed for', callId);
}

main().catch((e) => {
  console.error('❌ Capstone failed:', e.message);
  process.exit(2);
});
