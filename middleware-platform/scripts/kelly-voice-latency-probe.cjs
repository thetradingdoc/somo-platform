#!/usr/bin/env node
'use strict';

/**
 * Local Kelly turn latency probe — runs golden-path messages via runKellyTurn.
 * Usage: KELLY_RAILS_V2=1 node scripts/kelly-voice-latency-probe.cjs
 */
process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.KELLY_RAILS_FAST_RAG = process.env.KELLY_RAILS_FAST_RAG || '1';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { runKellyTurn } = require('../services/kelly-turn-resolver');

const MESSAGES = [
  'I have an itchy rash on my leg and neck for two days.',
  'Severity is about 6 out of 10, it started yesterday morning.',
  'Can I book an appointment tomorrow at noon?',
];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const sessionId = `latency_probe_${Date.now()}`;
  const clinicId = process.env.CLINIC_ID || 'clinic-default';
  const latencies = [];

  for (let i = 0; i < MESSAGES.length; i++) {
    const message = MESSAGES[i];
    const t0 = Date.now();
    const out = await runKellyTurn({
      sessionId,
      message,
      channel: 'voice',
      clinicId,
      turnReceivedAt: t0,
    });
    const ms = Date.now() - t0;
    latencies.push(ms);
    console.log(
      JSON.stringify({
        turn: i + 1,
        message: message.slice(0, 50),
        latency_ms: ms,
        tools: out?.toolsUsed || [],
        lane: out?.kelly_rails?.active_lane,
      })
    );
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const report = {
    session_id: sessionId,
    turns: latencies.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    max_ms: sorted[sorted.length - 1] || 0,
    target_p95_ms: 8000,
    pass: percentile(sorted, 95) <= 8000,
  };
  console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
