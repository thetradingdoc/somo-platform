#!/usr/bin/env node
/**
 * Smoke test for POST /api/public/landing-assistant/turn
 * Usage: middleware running on BASE (default http://127.0.0.1:4000)
 *   node scripts/test-public-landing-assistant.cjs
 * Requires DEFAULT_CLINIC_ID or PRIMARY_CLINIC_ID in middleware env (or pass ? clinic via body).
 */
const BASE = process.env.MIDDLEWARE_BASE || 'http://127.0.0.1:4000';

async function main() {
  const url = `${BASE.replace(/\/$/, '')}/api/public/landing-assistant/turn`;
  const body = {
    message: 'What is a good moisturizer for dry skin?',
    session_id: `landing_smoke_${Date.now()}`
  };
  const clinic = process.env.CLINIC_ID_FOR_TEST;
  if (clinic) body.clinic_id = clinic;

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('Non-JSON response', r.status, text.slice(0, 500));
    process.exit(1);
  }
  if (!r.ok || !json.success) {
    console.error('Request failed', r.status, json);
    process.exit(1);
  }
  console.log('OK', { session_id: json.session_id, reply_preview: String(json.reply || '').slice(0, 160) });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
