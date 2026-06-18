#!/usr/bin/env node
/**
 * Serves unified-dashboard statically and captures patient portal HTML states.
 * Run from repo root: npm run capture:patient-portal-screenshots
 *
 * Optional: PATIENT_SCREENSHOT_SESSION_ID — value stored in localStorage as patient_session_id
 * so pages do not immediately redirect to login (API calls may still fail).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const staticRoot = path.join(repoRoot, 'unified-dashboard');
const outDir = path.join(repoRoot, 'tmp/patient-app-screenshots');
const sessionId = process.env.PATIENT_SCREENSHOT_SESSION_ID || '';

const targets = [
  ['home', '/patients/patient-dashboard.html'],
  ['routine', '/patients/appointments.html'],
  ['calendar', '/patients/schedule.html'],
  ['products', '/patients/my-records.html']
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

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { server, port } = await startStaticServer();
  const base = `http://127.0.0.1:${port}`;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.error(
      'Playwright Chromium is not installed. From the repo root run:\n' +
        '  npx playwright install chromium\n' +
        'Then re-run: npm run capture:patient-portal-screenshots\n',
      e.message || e
    );
    server.close();
    process.exit(1);
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1
  });
  if (sessionId) {
    await context.addInitScript((sid) => {
      try {
        localStorage.setItem('patient_session_id', sid);
      } catch (_) {}
    }, sessionId);
  }

  const page = await context.newPage();
  try {
    for (const [name, p] of targets) {
      const url = `${base}${p}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 900));
      const outFile = path.join(outDir, `portal-${name}-1280.png`);
      await page.screenshot({ path: outFile, fullPage: true });
      console.log('Wrote', outFile);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
