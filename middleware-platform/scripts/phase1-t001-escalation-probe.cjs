#!/usr/bin/env node
'use strict';

/**
 * T-001 escalation probe: Retell register + WS on prod API, poll transfer target for inbound ring.
 */

const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_WS = process.env.CAPSTONE_API_WS || 'wss://api.callsomo.com/webhook/retell/llm';
const RETELL_KEY = process.env.RETELL_API_KEY;
const AGENT_ID = process.env.RETELL_AGENT_ID;
const CUSTOMER_ID = process.env.CAPSTONE_CUSTOMER_ID || 'cust_96848972-8121-4ddb-b16c-dc99a2c8ef13';
const CLINIC_ID = process.env.CAPSTONE_CLINIC_ID || 'clinic-doclittle';
const FROM = process.env.CAPSTONE_FROM_NUMBER || '+12028131474';
const TO = process.env.CAPSTONE_TENANT_DID || '+18623622415';
const TRANSFER_TARGET = process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN || '+12028131474';

const UTTERANCES = [
  'Transfer me to a human right now.',
  'I cannot verify my identity. Please escalate.',
  'Connect me to a live person immediately.'
];

async function registerCall() {
  const meta = {
    call_type: 'tenant',
    direction: 'inbound',
    customer_id: CUSTOMER_ID,
    clinic_id: CLINIC_ID,
    site_context_status: 'verified',
    routing_world: 'tenant'
  };
  const res = await axios.post(
    'https://api.retellai.com/v2/register-phone-call',
    {
      agent_id: AGENT_ID,
      audio_websocket_protocol: 'twilio',
      audio_encoding: 'mulaw',
      sample_rate: 8000,
      from_number: FROM,
      to_number: TO,
      metadata: meta,
      retell_llm_dynamic_variables: meta
    },
    { headers: { Authorization: `Bearer ${RETELL_KEY}` }, timeout: 20000 }
  );
  return res.data.call_id;
}

function pollTransferInbound(sinceMs) {
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return twilio.calls
    .list({ to: TRANSFER_TARGET, limit: 10 })
    .then((calls) =>
      calls.filter((c) => {
        const t = new Date(c.dateCreated).getTime();
        return t >= sinceMs && ['ringing', 'in-progress', 'completed'].includes(c.status);
      })
    );
}

async function driveWs(callId) {
  const wsUrl = `${API_WS.replace(/\/$/, '')}/${callId}`;
  const transcript = [];
  let responseId = 0;
  let transferFrame = false;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: { 'x-retell-call-id': callId } });
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      resolve();
    }, 120000);

    const meta = {
      call_type: 'tenant',
      direction: 'inbound',
      customer_id: CUSTOMER_ID,
      clinic_id: CLINIC_ID,
      site_context_status: 'verified'
    };

    const sendUser = (text) => {
      transcript.push({ role: 'user', content: text });
      responseId += 1;
      ws.send(
        JSON.stringify({
          interaction_type: 'response_required',
          response_id: responseId,
          transcript: [...transcript]
        })
      );
    };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          interaction_type: 'call_details',
          call_id: callId,
          from_number: FROM,
          to_number: TO,
          agent_id: AGENT_ID,
          metadata: meta,
          dynamic_variables: meta
        })
      );
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch (_) {
        return;
      }
      if (msg.transfer_number) {
        transferFrame = true;
        console.log('✅ WS transfer frame:', msg.transfer_number);
      }
      if (msg.content) {
        transcript.push({ role: 'agent', content: msg.content });
        const idx = transcript.filter((t) => t.role === 'user').length;
        if (idx < UTTERANCES.length) {
          setTimeout(() => sendUser(UTTERANCES[idx]), 8000);
        } else {
          setTimeout(() => ws.close(), 5000);
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on('error', reject);
    setTimeout(() => sendUser(UTTERANCES[0]), 4000);
  });

  return { transferFrame };
}

async function main() {
  const start = Date.now();
  const callId = await registerCall();
  console.log('Registered', callId);
  const { transferFrame } = await driveWs(callId);
  await new Promise((r) => setTimeout(r, 15000));
  const inbound = await pollTransferInbound(start - 5000);
  const rang = inbound.length > 0;
  console.log(
    JSON.stringify(
      {
        pass: transferFrame && rang,
        call_id: callId,
        transfer_frame: transferFrame,
        pstn_rang: rang,
        transfer_target: TRANSFER_TARGET,
        inbound_calls: inbound.map((c) => ({
          sid: c.sid,
          from: c.from,
          status: c.status,
          duration: c.duration
        }))
      },
      null,
      2
    )
  );
  process.exit(transferFrame && rang ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
