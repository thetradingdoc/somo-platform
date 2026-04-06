#!/usr/bin/env node
/**
 * Smoke: running middleware responds; patient routes require auth.
 *
 *   MIDDLEWARE_BASE_URL=http://127.0.0.1:4000 node scripts/e2e-middleware-http-smoke.cjs
 */

const base = (process.env.MIDDLEWARE_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function main() {
  const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
  console.log('GET /health →', h.status, h.ok ? 'ok' : 'fail');

  const r = await fetch(`${base}/api/patient/derm-qa/triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'test' }),
    signal: AbortSignal.timeout(5000)
  });
  console.log('POST /api/patient/derm-qa/triage (no session) →', r.status, '(expect 401/403)');

  const r2 = await fetch(`${base}/api/patient/derm-qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'test' }),
    signal: AbortSignal.timeout(5000)
  });
  console.log('POST /api/patient/derm-qa (no session) →', r2.status, '(expect 401/403)');
}

main().catch((e) => {
  console.error('Smoke failed (is middleware running on', base, '?):', e.message);
  process.exit(1);
});
