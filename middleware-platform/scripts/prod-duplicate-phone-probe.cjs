#!/usr/bin/env node
'use strict';

/**
 * Production probe: first request-call succeeds (or rate-limited), second same phone → 429 DUPLICATE_PHONE_WINDOW.
 * Uses a synthetic +1500555XXXX number. Does NOT place a live Twilio call if mock is used in test env.
 */
const API = (process.env.API_BASE_URL || 'https://api.callsomo.com').replace(/\/$/, '');
const phone = process.env.PROBE_PHONE || `+1500555${String(Date.now() % 10000).padStart(4, '0')}`;

async function post(body) {
  const t0 = Date.now();
  const res = await fetch(`${API}/api/public/somo-demo/request-call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, ms: Date.now() - t0, json };
}

async function main() {
  const payload = {
    name: 'DuplicateProbe',
    phone,
    consent: true,
    questions_asked: 'pre-demo duplicate phone probe'
  };
  const first = await post(payload);
  const second = await post(payload);
  const report = {
    run_at: new Date().toISOString(),
    api: API,
    phone_masked: phone.replace(/\d(?=\d{4})/g, '*'),
    first: { status: first.status, error_code: first.json?.error_code, success: first.json?.success },
    second: { status: second.status, error_code: second.json?.error_code, success: second.json?.success },
    pass:
      (first.status === 200 && first.json?.success === true) ||
      first.json?.error_code === 'DAILY_CAP_REACHED' ||
      first.json?.error_code === 'CONCURRENT_CAP_REACHED'
        ? second.status === 429 && second.json?.error_code === 'DUPLICATE_PHONE_WINDOW'
        : false
  };
  if (!report.pass && first.status === 200 && first.json?.success) {
    report.pass = second.status === 429 && second.json?.error_code === 'DUPLICATE_PHONE_WINDOW';
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
