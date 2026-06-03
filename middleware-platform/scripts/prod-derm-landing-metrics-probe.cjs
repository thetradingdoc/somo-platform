#!/usr/bin/env node
'use strict';

/**
 * Production probe: dermatology-practice persona on landing-assistant + barcode lookup.
 * Emits JSON for latency/availability (not CER/WER — no reference transcripts).
 */
const API_BASE = (process.env.PW_PROD_API_BASE_URL || 'https://api.callsomo.com').replace(/\/$/, '');
const UI_BASE = (process.env.PW_UI_BASE_URL || 'https://callsomo.com').replace(/\/$/, '');

async function timedFetch(url, init) {
  const t0 = Date.now();
  const res = await fetch(url, init);
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = { _raw_preview: text.slice(0, 200) };
  }
  return { status: res.status, ms, json, contentType: res.headers.get('content-type') };
}

async function main() {
  const sessionId = `derm_prod_eval_${Date.now()}`;
  const messages = [
    'Hi — I run a dermatology practice and need after-hours phone coverage.',
    'We get calls about rashes, acne follow-ups, and Mohs scheduling.',
    'Can Somo handle Spanish-speaking patients too?'
  ];

  const health = await timedFetch(`${API_BASE}/api/public/somo-demo/health`);
  const turns = [];
  for (const message of messages) {
    const r = await timedFetch(`${API_BASE}/api/public/landing-assistant/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, message })
    });
    const reply = String(r.json?.reply || r.json?.message || r.json?.assistant_message || '').trim();
    turns.push({
      message: message.slice(0, 60),
      status: r.status,
      latency_ms: r.ms,
      reply_chars: reply.length,
      reply_preview: reply.slice(0, 120)
    });
  }

  const barcode = '3337875696548';
  const scan = await timedFetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(barcode)}`);

  const ui = await timedFetch(`${UI_BASE}/`);

  const report = {
    run_at: new Date().toISOString(),
    persona: 'dermatology_practice_owner',
    api_base: API_BASE,
    ui_base: UI_BASE,
    somo_demo_health: {
      status: health.status,
      latency_ms: health.ms,
      demo_enabled: health.json?.demo_enabled
    },
    landing_assistant_turns: turns,
    barcode_lookup: {
      barcode,
      status: scan.status,
      latency_ms: scan.ms,
      success: !!scan.json?.success,
      product_name: scan.json?.product?.product_name || null
    },
    ui_home: { status: ui.status, latency_ms: ui.ms }
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
