'use strict';

/**
 * Smoke test Somo demo API (no Twilio). Requires restarted middleware.
 * Usage: node scripts/somo-demo-smoke.cjs
 */
const somoDemoEnv = require('../lib/somo-demo-env');

const base = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function getHealth() {
  const health = await fetch(`${base}/api/public/somo-demo/health`);
  const body = await health.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch (_) {}
  return { ok: health.ok, status: health.status, body: parsed || body };
}

async function main() {
  const canonical = await getHealth();
  if (!canonical.ok) {
    console.error('Canonical health failed:', canonical.status, canonical.body);
    process.exit(1);
  }
  console.log('health:somo-demo', canonical.body);

  const bad = await fetch(`${base}/api/public/somo-demo/request-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test',
      phone: '+15555550123',
      use_case: 'receptionist',
      consent: false
    })
  });
  const badBody = await bad.json();
  if (bad.status !== 400 || !/consent/i.test(badBody.error || '') || badBody.error_code !== 'CONSENT_REQUIRED') {
    console.error('Expected consent error, got', bad.status, badBody);
    process.exit(1);
  }
  console.log('consent validation ok');

  const prevEnabled = process.env.SOMO_DEMO_ENABLED;
  process.env.SOMO_DEMO_ENABLED = '0';
  const disabled = await fetch(`${base}/api/public/somo-demo/request-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test',
      phone: '+15555550199',
      use_case: 'receptionist',
      consent: true
    })
  });
  const disabledBody = await disabled.json();
  if (disabled.status !== 400 && disabled.status !== 503) {
    console.warn('Flag-off test: expected 400/503, got', disabled.status, disabledBody);
  } else {
    console.log('demo disabled gate ok');
  }
  if (prevEnabled !== undefined) process.env.SOMO_DEMO_ENABLED = prevEnabled;
  else delete process.env.SOMO_DEMO_ENABLED;

  if (somoDemoEnv.getSmokePlaceCall()) {
    const ok = await fetch(`${base}/api/public/somo-demo/request-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Smoke',
        phone: somoDemoEnv.getSmokePhone(),
        use_case: 'receptionist',
        consent: true
      })
    });
    console.log('place call', ok.status, await ok.json());
  } else {
    console.log('Skip live call (set SOMO_DEMO_SMOKE_PLACE_CALL=1 and SOMO_DEMO_SMOKE_PHONE=+1...)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
