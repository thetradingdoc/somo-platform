#!/usr/bin/env node
'use strict';

/**
 * Parallel POST /voice/incoming smoke — mocked Retell register (no PSTN).
 */
process.chdir(require('path').join(__dirname, '..'));
process.env.VOICE_RATE_LIMIT_BACKEND = process.env.VOICE_RATE_LIMIT_BACKEND || 'memory';
process.env.SKIP_STARTUP_MIGRATIONS = '1';
process.env.SAAS_VOICE_LAZY_RETELL_ON_INBOUND = '1';
process.env.ENABLE_FHIR = 'false';
process.env.RETELL_API_KEY = process.env.RETELL_API_KEY || 'test-key';

const express = require('express');
const axios = require('axios');
const { createVoiceIncomingHandler } = require('../services/voice-incoming-handler');

const PORT = 0;
const PARALLEL = parseInt(process.env.VOICE_LOAD_PARALLEL || '20', 10);

const mockDb = {
  getCustomer(id) {
    if (id === 'cust_load') {
      return {
        id: 'cust_load',
        customer_type: 'saas',
        plan_tier: 'clinic_pro',
        retell_agent_id: 'agent_test',
        merchant_id: 'merch_test',
        subscription_status: 'active',
        stripe_subscription_id: 'sub_test',
        billing_enforcement_paused: 1
      };
    }
    return null;
  },
  getCustomerByTwilioNumber() {
    return null;
  },
  getClinicPhoneNumber() {
    return null;
  },
  getVoiceAgentSettingsForProvider() {
    return { agent_enabled: 1, greeting: 'Hello' };
  },
  getTotalAvailableMinutes: () => 100,
  logVoiceCall: async () => {},
  upsertCallSiteContext() {},
  insertKellyCallEvent() {},
  touchTrialActivity() {},
  db: {
    prepare() {
      return { get: () => null, run: () => {}, all: () => [] };
    }
  }
};

let registerCount = 0;
const registeredCallIds = [];
const originalPost = axios.post.bind(axios);
axios.post = async (url, body, opts) => {
  if (String(url).includes('register-phone-call')) {
    registerCount += 1;
    const callId = `load_call_${registerCount}_${Date.now()}`;
    registeredCallIds.push({ customerId: 'cust_load', callId });
    return {
      data: {
        call_id: callId,
        sip_uri: `sip:${callId}@mock.livekit.cloud`
      }
    };
  }
  return originalPost(url, body, opts);
};

async function main() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  const handler = createVoiceIncomingHandler({
    db: mockDb,
    normalizePhoneNumber: (p) => String(p || '').replace(/\D/g, '')
  });
  app.post('/voice/incoming', handler);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;

  const started = Date.now();
  const tasks = [];
  for (let i = 0; i < PARALLEL; i += 1) {
    const body = new URLSearchParams({
      From: '+15550001111',
      To: '+15550002222',
      CallSid: `CA_load_${i}_${started}`
    });
    tasks.push(
      fetch(`${base}/voice/incoming?customer_id=cust_load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }).then(async (res) => {
        const text = await res.text();
        return { status: res.status, text, i };
      })
    );
  }

  const results = await Promise.all(tasks);
  server.close();

  try {
    const voiceActiveCalls = require('../services/voice-active-calls-service');
    for (const row of registeredCallIds) {
      await voiceActiveCalls.releaseSlot(row.customerId, row.callId);
    }
    const active = await voiceActiveCalls.getActiveCount('cust_load');
    if (active !== 0) {
      console.warn(`WARN voice-load-smoke: ${active} slots still active after cleanup`);
    }
  } catch (cleanupErr) {
    console.warn('WARN voice-load-smoke cleanup:', cleanupErr.message);
  }

  const errors = results.filter((r) => r.status >= 500 || !r.text.includes('<Response>'));
  const elapsed = Date.now() - started;

  if (errors.length) {
    console.error(`FAIL: ${errors.length}/${PARALLEL} requests failed`);
    process.exit(1);
  }

  console.log(
    `OK voice-load-smoke parallel=${PARALLEL} registerCalls=${registerCount} elapsedMs=${elapsed} p95_est=${Math.round(elapsed)}`
  );
  setTimeout(() => process.exit(0), 250);
}

main().catch((err) => {
  console.error('FAIL voice-load-smoke:', err.message);
  process.exit(1);
});
