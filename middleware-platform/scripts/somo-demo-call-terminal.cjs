#!/usr/bin/env node
'use strict';

/**
 * Place a Somo landing demo outbound call and log status + Retell transcript in terminal.
 *
 * Usage:
 *   node scripts/somo-demo-call-terminal.cjs +18622307479
 *   API_BASE_URL=https://api.callsomo.com node scripts/somo-demo-call-terminal.cjs +18622307479
 *   SOMO_DEMO_CALL_LOCAL=1 node scripts/somo-demo-call-terminal.cjs +18622307479
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { latestCallTo } = require('./lib/verify-retell.cjs');

const phoneArg = process.argv[2];
if (!phoneArg) {
  console.error('Usage: node scripts/somo-demo-call-terminal.cjs +1XXXXXXXXXX');
  process.exit(1);
}

const apiBase = (process.env.API_BASE_URL || 'https://api.callsomo.com').replace(/\/$/, '');
const pollSec = parseInt(process.env.SOMO_DEMO_POLL_SEC || '3', 10);
const pollMax = parseInt(process.env.SOMO_DEMO_POLL_MAX || '40', 10);

function log(line) {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

function normalizeE164(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (String(phone).trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

async function requestViaApi(phone) {
  const res = await fetch(`${apiBase}/api/public/somo-demo/request-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Terminal Demo Test',
      phone,
      use_case: 'medical_clinic',
      consent: true,
      questions_asked: 'terminal somo-demo-call-terminal.cjs'
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.code = body.error_code;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function requestViaLocalService(phone) {
  const { requestDemoCall } = require('../services/somo-demo-service');
  return requestDemoCall({
    name: 'Terminal Demo Test',
    phone,
    use_case: 'medical_clinic',
    consent: true,
    questions_asked: 'terminal local service',
    clientIp: '127.0.0.1',
    attribution: { utm_source: 'terminal_script' }
  });
}

async function pollTwilio(callSid) {
  const twilio = require('twilio');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    log('WARN: TWILIO_ACCOUNT_SID/AUTH_TOKEN not set — skipping Twilio poll');
    return null;
  }
  const client = twilio(sid, token);
  let last = '';
  for (let i = 0; i < pollMax; i++) {
    const call = await client.calls(callSid).fetch();
    if (call.status !== last) {
      log(`Twilio ${callSid} → status=${call.status} duration=${call.duration || 0}s to=${call.to}`);
      last = call.status;
    }
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(call.status)) {
      try {
        const notes = await client.calls(callSid).notifications.list({ limit: 5 });
        for (const n of notes) {
          if (n.errorCode || n.message) log(`Twilio notice ${n.errorCode || ''} ${n.message || ''}`.trim());
        }
      } catch (_) {}
      return call;
    }
    await new Promise((r) => setTimeout(r, pollSec * 1000));
  }
  log('Twilio poll timeout — call may still be ringing');
  return client.calls(callSid).fetch();
}

async function pollRetellTranscript(phone, { startedAt } = {}) {
  if (!process.env.RETELL_API_KEY) {
    log('WARN: RETELL_API_KEY not set — skipping transcript fetch');
    return null;
  }
  const since = startedAt ? new Date(startedAt).getTime() - 60000 : Date.now() - 15 * 60 * 1000;
  for (let i = 0; i < 15; i++) {
    try {
      const call = await latestCallTo(phone);
      if (call) {
        const startMs = call.start_timestamp ? Number(call.start_timestamp) : 0;
        if (!startedAt || startMs >= since) {
          log(`Retell call_id=${call.call_id} status=${call.call_status} duration_ms=${call.duration_ms || 0}`);
          const transcript = String(call.transcript || '').trim();
          if (transcript) {
            console.log('\n--- Retell transcript ---\n');
            console.log(transcript);
            console.log('\n--- end transcript ---\n');
            return call;
          }
        }
      }
    } catch (e) {
      log(`Retell fetch: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  log('No Retell transcript yet (call may not have been answered)');
  return null;
}

async function main() {
  const phone = normalizeE164(phoneArg);
  log(`Somo demo terminal test → ${phone}`);
  log(`API base: ${apiBase}`);

  const health = await fetch(`${apiBase}/api/public/somo-demo/health`);
  const healthBody = await health.json().catch(() => ({}));
  log(`health: ${health.status} ${JSON.stringify(healthBody)}`);
  if (!health.ok) process.exit(1);

  const startedAt = Date.now();
  let result;
  try {
    if (process.env.SOMO_DEMO_CALL_LOCAL === '1') {
      log('Placing call via local requestDemoCall (needs Twilio env + public webhook URL)');
      result = await requestViaLocalService(phone);
    } else {
      log('Placing call via POST /api/public/somo-demo/request-call');
      result = await requestViaApi(phone);
    }
  } catch (e) {
    log(`request-call FAILED: ${e.message}${e.code ? ` (${e.code})` : ''}`);
    if (e.body) console.error(JSON.stringify(e.body, null, 2));
    process.exit(1);
  }

  log(`request-call OK demo_request_id=${result.demo_request_id} call_id=${result.call_id}`);
  log('Answer your phone now — polling Twilio then Retell transcript…');

  const twilioFinal = await pollTwilio(result.call_id);
  if (twilioFinal) {
    log(`Final Twilio status: ${twilioFinal.status}`);
    if (twilioFinal.status === 'no-answer') {
      log('TIP: no-answer = phone did not pick up within ~30s (or DND/voicemail). Retry when ready.');
    }
  }

  await pollRetellTranscript(phone, { startedAt });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
