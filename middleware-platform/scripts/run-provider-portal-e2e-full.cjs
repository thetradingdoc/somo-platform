#!/usr/bin/env node
'use strict';

/**
 * Full provider portal E2E: seed (local) → health check → API login → Playwright UI smoke.
 *
 * Local (default):
 *   npm run test:provider-portal:e2e-full --prefix middleware-platform
 *
 * Prod:
 *   TARGET=prod npm run test:provider-portal:e2e-full --prefix middleware-platform
 */

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TARGET = (process.env.TARGET || 'local').toLowerCase();
const BASE =
  TARGET === 'prod'
    ? (process.env.PROVIDER_PORTAL_BASE_URL || 'https://callsomo.com').replace(/\/$/, '')
    : (process.env.PROVIDER_PORTAL_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const API_BASE =
  TARGET === 'prod'
    ? (process.env.API_BASE_URL || 'https://api.callsomo.com').replace(/\/$/, '')
    : BASE;

function loadCredentials() {
  const fromEnv = {
    email: (process.env.PW_PROVIDER_EMAIL || process.env.SOMO_OWNER_EMAIL || '').trim(),
    password:
      process.env.PW_PROVIDER_PASSWORD ||
      process.env.PW_PROVIDER_PASS ||
      process.env.SOMO_OWNER_PASSWORD ||
      '',
  };
  if (fromEnv.email && fromEnv.password) return fromEnv;

  const credPath = path.join(ROOT, '..', 'local', 'provider-login.credentials');
  if (!fs.existsSync(credPath)) {
    if (TARGET === 'local') {
      return { email: 'provider@callsomo.com', password: 'demo123' };
    }
    return fromEnv;
  }
  const out = { ...fromEnv };
  for (const line of fs.readFileSync(credPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key === 'email' && !out.email) out.email = val;
    if (key === 'password' && !out.password) out.password = val;
  }
  return out;
}

function httpOk(url, timeoutMs = 3000) {
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

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env, ...opts });
  if (r.status !== 0) process.exit(r.status || 1);
}

async function ensureLocalReady() {
  const healthUrl = `${API_BASE}/health`;
  if (await httpOk(healthUrl)) {
    console.log(`[e2e-full] Server up at ${API_BASE}`);
    return null;
  }
  console.log('[e2e-full] Seeding demo accounts...');
  run(process.execPath, [path.join('scripts', 'data', 'seed-demo-accounts.js')], {
    cwd: ROOT,
    env: { ...process.env, ALLOW_DEMO_SEED: '1', DB_PATH: path.join(ROOT, 'var/db/middleware-dev.db') },
  });
  console.log('[e2e-full] Starting server on :4000...');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '4000', NODE_ENV: 'development' },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (await httpOk(healthUrl, 2000)) {
      console.log('[e2e-full] Server ready');
      return child;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error('[e2e-full] Server failed to start');
  process.exit(1);
}

async function apiLogin(creds) {
  const res = await fetch(`${API_BASE}/api/customers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password, remember_me: false }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success, status: res.status, json };
}

async function main() {
  let serverChild = null;
  if (TARGET === 'local') {
    serverChild = await ensureLocalReady();
  }

  const creds = loadCredentials();
  const localCreds =
    TARGET === 'local' && creds.email === 'drlittlekids@gmail.com'
      ? { email: 'provider@callsomo.com', password: 'demo123' }
      : creds;
  if (!localCreds.email || !localCreds.password) {
    console.error('[e2e-full] No credentials — set env or local/provider-login.credentials');
    process.exit(1);
  }

  console.log(`[e2e-full] API login test (${TARGET}) ${localCreds.email}...`);
  const login = await apiLogin(localCreds);
  if (!login.ok) {
    console.error(JSON.stringify({ step: 'api_login', target: TARGET, ...login }, null, 2));
    if (TARGET === 'prod') {
      console.error(
        '[e2e-full] Prod login failed. Owner account may need password reset on live DB (see scripts/reset-password.js + cloudrun-db-sync).'
      );
    }
    process.exit(1);
  }
  console.log('[e2e-full] API login OK');

  process.env.PW_PROVIDER_EMAIL = localCreds.email;
  process.env.PW_PROVIDER_PASSWORD = localCreds.password;
  process.env.PROVIDER_PORTAL_BASE_URL = BASE;
  run(process.execPath, ['scripts/provider-portal-journey-prod.cjs']);

  if (serverChild?.pid) {
    try {
      process.kill(-serverChild.pid, 'SIGTERM');
    } catch (_) {}
  }
  console.log('[e2e-full] PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
