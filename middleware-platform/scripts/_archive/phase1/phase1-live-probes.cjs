#!/usr/bin/env node
'use strict';

/**
 * Automated Phase 1 PSTN probes via Twilio (prod Cloud Run).
 * Requires TWILIO_* and PD4_PROBE_FROM_NUMBER (≠ platform DID).
 *
 * Usage:
 *   node scripts/phase1-live-probes.cjs demo
 *   node scripts/phase1-live-probes.cjs tenant
 *   node scripts/phase1-live-probes.cjs unidentified
 *   node scripts/phase1-live-probes.cjs t001
 *   node scripts/phase1-live-probes.cjs all
 */

const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const MP = path.join(__dirname, '..');
const PLATFORM_DID = process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER || '+13639990205';
const TENANT_DID = process.env.CAPSTONE_TENANT_DID || '+18623622415';
const PROBE_FROM = process.env.PD4_PROBE_FROM_NUMBER || '+12028131474';
const WAIT_MS = Number(process.env.PHASE1_PROBE_WAIT_MS || 60000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pullDb() {
  execSync(`bash "${path.join(ROOT, 'scripts', 'phase1-pull-prod-db.sh')}"`, {
    stdio: 'inherit',
    env: process.env
  });
  process.env.DB_PATH = path.join(ROOT, 'backups', 'middleware-staging.db');
}

async function twilioCall({ to, twiml, label }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN required');
  const twilio = require('twilio')(accountSid, authToken);
  const call = await twilio.calls.create({ to, from: PROBE_FROM, twiml, timeout: 90 });
  console.log(`[${label}] placed ${call.sid} ${PROBE_FROM} → ${to}`);
  return call.sid;
}

async function probeDemo() {
  await twilioCall({
    to: PLATFORM_DID,
    label: 'demo',
    twiml:
      '<Response><Say voice="Polly.Joanna">Hi, I run a dental practice and wanted to learn about Somo.</Say><Pause length="40"/><Say>Can I make a booking?</Say><Pause length="20"/><Hangup/></Response>'
  });
  await sleep(WAIT_MS);
  pullDb();
  execSync('node scripts/pd-4-platform-live-verify.cjs --latest', {
    cwd: MP,
    stdio: 'inherit',
    env: { ...process.env, DB_PATH: path.join(ROOT, 'backups', 'middleware-staging.db') }
  });
}

async function probeTenant() {
  await twilioCall({
    to: TENANT_DID,
    label: 'tenant',
    twiml:
      '<Response><Say voice="Polly.Joanna">Hello, I would like to make an appointment please.</Say><Pause length="50"/><Say>Yes, stomach pain for two days. Any time this week works for me.</Say><Pause length="50"/><Say>Yes, that time works. Please book it.</Say><Pause length="30"/><Hangup/></Response>'
  });
  await sleep(WAIT_MS);
  pullDb();
  const session = latestRetellTo(TENANT_DID);
  if (!session) throw new Error('No Retell call to tenant DID');
  execSync(
    `node scripts/voice-routing-matrix-live.cjs --tenant-book --session ${JSON.stringify(session)}`,
    {
      cwd: MP,
      stdio: 'inherit',
      env: { ...process.env, DB_PATH: path.join(ROOT, 'backups', 'middleware-staging.db') }
    }
  );
}

async function probeUnidentified() {
  // Inbound without customer_id metadata — use platform DID with minimal utterance
  await twilioCall({
    to: PLATFORM_DID,
    label: 'unidentified',
    twiml:
      '<Response><Say voice="Polly.Joanna">I need to speak to someone right now.</Say><Pause length="35"/><Hangup/></Response>'
  });
  await sleep(WAIT_MS);
  pullDb();
  const session = latestKellyFailClosed();
  if (!session) throw new Error('No fail-closed session in DB — may need true unknown DID path');
  execSync(
    `node scripts/voice-routing-matrix-live.cjs --fail-closed --session ${JSON.stringify(session)}`,
    {
      cwd: MP,
      stdio: 'inherit',
      env: { ...process.env, DB_PATH: path.join(ROOT, 'backups', 'middleware-staging.db') }
    }
  );
}

async function probeT001() {
  await twilioCall({
    to: TENANT_DID,
    label: 't001',
    twiml:
      '<Response><Say voice="Polly.Joanna">Transfer me to a human please. I cannot verify my identity.</Say><Pause length="40"/><Hangup/></Response>'
  });
  await sleep(WAIT_MS);
  pullDb();
  const session = latestRetellTo(TENANT_DID);
  console.log(`T-001 candidate session: ${session || '—'} — confirm transfer ring + Retell frame manually`);
}

function latestRetellTo(toNumber) {
  const key = process.env.RETELL_API_KEY;
  if (!key) return null;
  const r = execSync(
    `curl -s -X POST https://api.retellai.com/v2/list-calls -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d ${JSON.stringify(
      JSON.stringify({
        filter_criteria: { to_number: [toNumber] },
        limit: 1,
        sort_order: 'descending'
      })
    )}`,
    { encoding: 'utf8' }
  );
  const calls = JSON.parse(r);
  return Array.isArray(calls) && calls[0]?.call_id ? calls[0].call_id : null;
}

function latestKellyFailClosed() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(ROOT, 'backups', 'middleware-staging.db');
  const db = new Database(dbPath, { readonly: true });
  const row = db
    .prepare(
      `SELECT session_id FROM kelly_call_events
       WHERE event_type = 'handoff_escalations'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get();
  db.close();
  return row?.session_id || null;
}

async function main() {
  const cmd = process.argv[2] || 'demo';
  if (PROBE_FROM.replace(/\D/g, '') === PLATFORM_DID.replace(/\D/g, '')) {
    throw new Error('PD4_PROBE_FROM_NUMBER must differ from platform DID');
  }
  console.log(`Probe FROM=${PROBE_FROM} platform=${PLATFORM_DID} tenant=${TENANT_DID}`);
  switch (cmd) {
    case 'demo':
      return probeDemo();
    case 'tenant':
      return probeTenant();
    case 'unidentified':
      return probeUnidentified();
    case 't001':
      return probeT001();
    case 'all':
      await probeDemo();
      await probeTenant();
      await probeUnidentified();
      await probeT001();
      return;
    default:
      console.error('Usage: phase1-live-probes.cjs demo|tenant|unidentified|t001|all');
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
