'use strict';

/**
 * Smoke test Somo demo demo API (no Twilio). Requires restarted middleware.
 * Usage: node scripts/somo-demo-smoke.cjs
 */
const base = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function main() {
  const health = await fetch(`${base}/api/public/somo-demo/health`);
  if (!health.ok) {
    console.error('Health failed:', health.status, await health.text());
    process.exit(1);
  }
  const h = await health.json();
  console.log('health', h);

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
  if (bad.status !== 400 || !/consent/i.test(badBody.error || '')) {
    console.error('Expected consent error, got', bad.status, badBody);
    process.exit(1);
  }
  console.log('consent validation ok');

  const prevEnabled = process.env.DODGECALL_DEMO_ENABLED;
  process.env.DODGECALL_DEMO_ENABLED = '0';
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
  if (prevEnabled !== undefined) process.env.DODGECALL_DEMO_ENABLED = prevEnabled;
  else delete process.env.DODGECALL_DEMO_ENABLED;

  if (process.env.DODGECALL_SMOKE_PLACE_CALL === '1') {
    const ok = await fetch(`${base}/api/public/somo-demo/request-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Smoke',
        phone: process.env.DODGECALL_SMOKE_PHONE,
        use_case: 'receptionist',
        consent: true
      })
    });
    console.log('place call', ok.status, await ok.json());
  } else {
    console.log('Skip live call (set DODGECALL_SMOKE_PLACE_CALL=1 and DODGECALL_SMOKE_PHONE=+1...)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
