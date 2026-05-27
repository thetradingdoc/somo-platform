/* eslint-disable no-console */
'use strict';

// Usage:
//   node scripts/playwright-login-perf.cjs
//   BASE_URL=http://localhost:4000 node scripts/playwright-login-perf.cjs
//
// Output:
//   - Console timings (TTFB, DOMContentLoaded-ish, total)
//   - Slowest network requests
//   - Trace zip path (if enabled)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const TARGET = `${BASE_URL.replace(/\/$/, '')}/login`;

function fmtMs(n) {
  if (n == null || Number.isNaN(n)) return 'n/a';
  return `${Math.round(n)}ms`;
}

async function main() {
  const traceDir = path.join(process.cwd(), 'playwright-traces');
  if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true });
  const traceZip = path.join(traceDir, `login-trace-${Date.now()}.zip`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const reqTimings = new Map(); // request -> { start, url, method, resourceType }
  const finished = []; // { url, method, status, start, end, dur, type }

  page.on('request', (req) => {
    try {
      reqTimings.set(req, {
        start: Date.now(),
        url: req.url(),
        method: req.method(),
        type: req.resourceType()
      });
    } catch (_) {}
  });

  page.on('requestfinished', async (req) => {
    const t = reqTimings.get(req);
    if (!t) return;
    const end = Date.now();
    let status = null;
    try {
      const resp = await req.response();
      status = resp ? resp.status() : null;
    } catch (_) {}
    finished.push({
      url: t.url,
      method: t.method,
      status,
      start: t.start,
      end,
      dur: end - t.start,
      type: t.type
    });
  });

  page.on('requestfailed', (req) => {
    const t = reqTimings.get(req);
    if (!t) return;
    const end = Date.now();
    finished.push({
      url: t.url,
      method: t.method,
      status: 'FAILED',
      start: t.start,
      end,
      dur: end - t.start,
      type: t.type
    });
  });

  // Capture a full trace so we can inspect waterfall if needed.
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  const wallStart = Date.now();
  let resp = null;
  try {
    resp = await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  } catch (e) {
    console.error('Navigation failed:', e.message);
  }
  const afterDom = Date.now();

  // Wait for the login form to appear (this is the user-perceived “ready”).
  let formReady = null;
  try {
    await page.waitForSelector('#loginForm', { timeout: 60_000 });
    formReady = Date.now();
  } catch (_) {}

  // Then wait for network to settle (helps catch slow XHR like /api/tenant/config).
  try {
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
  } catch (_) {}
  const wallEnd = Date.now();

  await context.tracing.stop({ path: traceZip });
  await browser.close();

  const status = resp ? resp.status() : null;
  console.log('\n=== /login perf ===');
  console.log('Target:', TARGET);
  console.log('HTTP status:', status);
  console.log('DOMContentLoaded:', fmtMs(afterDom - wallStart));
  console.log('Login form visible:', fmtMs(formReady ? formReady - wallStart : null));
  console.log('Total (networkidle or timeout):', fmtMs(wallEnd - wallStart));

  const top = finished
    .slice()
    .sort((a, b) => (b.dur || 0) - (a.dur || 0))
    .slice(0, 15);

  console.log('\n=== Slowest requests (top 15) ===');
  for (const r of top) {
    const u = r.url.replace(BASE_URL, '');
    console.log(`${String(r.method).padEnd(4)} ${String(r.status).padEnd(6)} ${String(r.type).padEnd(10)} ${fmtMs(r.dur).padStart(8)}  ${u}`);
  }

  // Highlight likely culprits (tenant config / auth / payor / large static)
  const suspects = top.filter((r) => /\/api\/tenant\/config|\/api\/customers\/login|\/api\/auth\/login|\/api\/rcm\/|\/api\/claims|\/api\/prior-auth|\/unified-dashboard\//.test(r.url));
  if (suspects.length) {
    console.log('\n=== Suspect slow calls ===');
    for (const r of suspects) {
      const u = r.url.replace(BASE_URL, '');
      console.log(`${String(r.method).padEnd(4)} ${String(r.status).padEnd(6)} ${fmtMs(r.dur).padStart(8)}  ${u}`);
    }
  }

  console.log('\nTrace saved:', traceZip);
  console.log('Open trace with: npx playwright show-trace ' + traceZip);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

