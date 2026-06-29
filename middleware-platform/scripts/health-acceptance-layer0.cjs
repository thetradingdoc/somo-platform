#!/usr/bin/env node
'use strict';

/**
 * Layer 0 acceptance: emergency short-circuit latency (no Groq).
 */
process.env.GROQ_API_KEY = '';

const healthTurnService = require('../services/health-turn-service');
const healthSessionService = require('../services/health-session-service');

const SAMPLES = 10;
const P95_MAX_MS = 2000;

async function main() {
  const latencies = [];

  for (let i = 0; i < SAMPLES; i++) {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const start = Date.now();
    await healthTurnService.processOneTurn(session.room_id, 'severe chest pain and shortness of breath', {
      speaker: 'patient',
      source: 'acceptance-layer0'
    });
    latencies.push(Date.now() - start);
    healthTurnService.resetQueue(session.room_id);
  }

  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  console.log(`[health-acceptance-layer0] samples=${SAMPLES} avg_ms=${avg} p95_ms=${p95}`);

  if (p95 > P95_MAX_MS) {
    console.error(`FAIL: p95 ${p95}ms exceeds ${P95_MAX_MS}ms`);
    process.exit(1);
  }
  console.log('PASS: emergency short-circuit latency');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
