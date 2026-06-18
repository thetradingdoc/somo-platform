#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const staticRoot = path.join(repoRoot, 'unified-dashboard');
const outDir = path.join(repoRoot, 'tmp/patient-app-screenshots/visual-pass');

const targets = [
  { name: 'wallet-desktop', page: '/patients/wallet.html', viewport: { width: 1366, height: 900 } },
  { name: 'wallet-mobile', page: '/patients/wallet.html', viewport: { width: 390, height: 844 } },
  { name: 'appointments-desktop', page: '/patients/appointments.html', viewport: { width: 1366, height: 900 } },
  { name: 'appointments-mobile', page: '/patients/appointments.html', viewport: { width: 390, height: 844 } }
];

function mimeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.webmanifest')) return 'application/manifest+json';
  return 'application/octet-stream';
}

function safeFileForUrlPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  const rel = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.join(staticRoot, rel);
  if (!abs.startsWith(staticRoot)) return null;
  return abs;
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    let filePath = safeFileForUrlPath(u.pathname);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.on('error', reject);
  });
}

function jsonRoute(payload) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function setupMockRoutes(page) {
  await page.route('**/api/patient/me', async (route) => {
    await route.fulfill(jsonRoute({ success: true, patient: { id: 'p-1' } }));
  });

  await page.route('**/api/patient/p-1/cards', async (route) => {
    await route.fulfill(
      jsonRoute({
        success: true,
        cards: [{ last4: '4242', expiry: '08/29', cardholder_name: 'Jeremiah Richard', brand: 'visa' }]
      })
    );
  });

  await page.route('**/api/patient/appointments*', async (route) => {
    await route.fulfill(
      jsonRoute({
        success: true,
        appointments: [
          {
            id: 'a1',
            appointment_type: 'Dermatology Follow-up',
            provider: 'Dr. Amina Patel',
            date: '2026-04-23',
            time: '11:00 AM',
            datetime_display: 'Apr 23, 2026 at 11:00 AM',
            timezone: 'America/New_York',
            status: 'scheduled',
            can_reschedule: true,
            can_cancel: true,
            payment_status: 'unpaid',
            payment_link: 'https://example.com/pay'
          },
          {
            id: 'a2',
            appointment_type: 'Routine Check-in',
            provider: 'Dr. Lee',
            date: '2026-04-24',
            time: '2:30 PM',
            datetime_display: 'Apr 24, 2026 at 2:30 PM',
            timezone: 'America/New_York',
            status: 'confirmed',
            can_reschedule: true,
            can_cancel: true,
            payment_status: 'paid'
          }
        ]
      })
    );
  });

  await page.route('**/api/patient/routine-template*', async (route) => {
    await route.fulfill(jsonRoute({ success: true, template: null }));
  });

  await page.route('**/api/patient/shelf/products*', async (route) => {
    await route.fulfill(
      jsonRoute({
        success: true,
        products: [
          { id: 's1', product_name: 'Daily Cleanser', usage_time: 'morning', badge_initials: 'DC', badge_color: '#314DB6' }
        ]
      })
    );
  });

  await page.route('**/api/patient/receipts*', async (route) => {
    await route.fulfill(
      jsonRoute({
        success: true,
        receipts: [{ id: 'r1', amount: 45, currency: 'USD', source: 'invoice', status: 'issued', created_at: '2026-04-22' }]
      })
    );
  });

  await page.route('**/api/**', async (route) => {
    await route.fulfill(jsonRoute({ success: true }));
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { server, port } = await startStaticServer();
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    for (const target of targets) {
      const context = await browser.newContext({ viewport: target.viewport });
      await context.addInitScript(() => {
        localStorage.setItem('patient_session_id', 'pw-visual-pass');
        localStorage.setItem('patient_phone', '+15555555555');
      });
      const page = await context.newPage();
      await setupMockRoutes(page);
      await page.goto(`${base}${target.page}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(900);
      const outFile = path.join(outDir, `${target.name}.png`);
      await page.screenshot({ path: outFile, fullPage: true });
      console.log(`Wrote ${outFile}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
