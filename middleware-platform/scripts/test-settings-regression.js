'use strict';

/**
 * Lightweight regression checks for settings APIs.
 * Run with server up: node scripts/test-settings-regression.js
 */

const BASE = process.env.API_BASE || 'http://localhost:4000';

async function hit(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  let body = null;
  try { body = await res.json(); } catch (_) {}
  return { status: res.status, body };
}

async function main() {
  const checks = [
    ['/api/customers/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_name: 'x' }) }],
    ['/api/customers/me/notification-settings', {}],
    ['/api/customers/me/sessions', {}],
    ['/api/customers/me/email-change/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_email: 'x@example.com' }) }],
    ['/api/customers/me/services-status', {}],
    ['/api/merchant/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhook_url: 'https://example.com/hook' }) }]
  ];

  let failed = 0;
  for (const [path, init] of checks) {
    const out = await hit(path, init);
    const ok = out.status === 401 || out.status === 200 || out.status === 400;
    if (!ok) failed++;
    console.log(`${ok ? 'OK' : 'FAIL'} ${path} -> ${out.status}`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

