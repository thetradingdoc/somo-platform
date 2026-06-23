#!/usr/bin/env node
'use strict';

/**
 * Boot server.js on an ephemeral port and poll /health/live.
 * Catches route registration / module path crashes before Cloud Run deploy.
 *
 * Run: node scripts/verify/verify-server-boot.cjs
 */

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const MP = path.join(__dirname, '..', '..');
const TIMEOUT_MS = parseInt(process.env.SERVER_BOOT_TIMEOUT_MS || '90000', 10) || 90000;
const POLL_MS = 500;

function pickPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function httpOk(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const port = await pickPort();
  const healthUrl = `http://127.0.0.1:${port}/health/live`;
  const stderrChunks = [];

  const child = spawn(process.execPath, ['server.js'], {
    cwd: MP,
    env: {
      ...process.env,
      VERIFY_SERVER_BOOT: '1',
      NODE_ENV: 'test',
      PORT: String(port),
      DEV_LIGHT_START: '1',
      SKIP_STARTUP_MIGRATIONS: '1',
      DB_PATH: ':memory:',
      CATALOG_MASTER_SYNC_ENABLED: '0',
      EHR_SYNC_ENABLED: '0',
      NOTIFICATION_QUEUE_ENABLED: '0',
      KELLY_QUIET: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr.on('data', (buf) => {
    const s = buf.toString();
    stderrChunks.push(s);
    if (stderrChunks.join('').length > 12000) stderrChunks.shift();
  });

  const started = Date.now();
  let ok = false;
  while (Date.now() - started < TIMEOUT_MS) {
    if (child.exitCode !== null) break;
    if (await httpOk(healthUrl)) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  try {
    child.kill('SIGTERM');
  } catch (_) {}
  await new Promise((r) => setTimeout(r, 300));
  try {
    child.kill('SIGKILL');
  } catch (_) {}

  if (ok) {
    console.log(`✓ server boot OK (${healthUrl}, ${Date.now() - started}ms)`);
    process.exit(0);
  }

  const tail = stderrChunks.join('').split('\n').slice(-40).join('\n');
  console.error(`✗ server boot failed (no /health/live within ${TIMEOUT_MS}ms)`);
  if (child.exitCode !== null) {
    console.error(`  exit code: ${child.exitCode}`);
  }
  if (tail.trim()) {
    console.error('--- stderr (last 40 lines) ---');
    console.error(tail);
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
