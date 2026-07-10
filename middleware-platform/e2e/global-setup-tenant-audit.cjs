'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const AUDIT_URL = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');

function waitForHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${AUDIT_URL}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        if (Date.now() > deadline) return reject(new Error(`health status ${res.statusCode}`));
        setTimeout(tick, 500);
      });
      req.on('error', () => {
        if (Date.now() > deadline) return reject(new Error('audit middleware did not start'));
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

function killAuditPort() {
  try {
    const port = new URL(AUDIT_URL).port || '4001';
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch (_) {}
}

module.exports = async () => {
  const forceRestart =
    process.env.TENANT_AUDIT_FORCE_RESTART === '1' || process.argv.includes('--force-restart');

  if (forceRestart) {
    killAuditPort();
    await new Promise((r) => setTimeout(r, 800));
  } else {
    try {
      await waitForHealth(3000);
      console.log('[tenant-audit setup] Reusing existing audit middleware');
      return;
    } catch (_) {}
  }

  const cwd = path.join(__dirname, '..');
  const child = spawn('node', ['scripts/start-audit-middleware.cjs'], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, AUDIT_MIDDLEWARE: '1' },
    detached: true
  });
  child.unref();
  process.env.TENANT_AUDIT_SERVER_PID = String(child.pid);
  await waitForHealth();
  console.log('[tenant-audit setup] Audit middleware ready on', AUDIT_URL);
};
