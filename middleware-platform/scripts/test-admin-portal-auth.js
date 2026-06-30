#!/usr/bin/env node
/**
 * Admin portal auth diagnostic — production 401 probe, local session probe, frontend contract checks.
 *
 * Usage:
 *   node scripts/test-admin-portal-auth.js --production
 *   node scripts/test-admin-portal-auth.js --local
 *   node scripts/test-admin-portal-auth.js --local --with-session
 *   node scripts/test-admin-portal-auth.js --static-only
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PRODUCTION_BASE = 'https://api.callsomo.com';
const LOCAL_BASE = 'http://localhost:4000';

const ADMIN_ENDPOINTS = [
  { path: '/api/admin/scrape/status', expectAuth: true },
  { path: '/api/admin/tenants/alerts', expectAuth: true },
  { path: '/api/admin/scrape/leads/pipeline', expectAuth: true },
  { path: '/api/admin/session', expectAuth: true, expectSessionUnauth: true },
];

const args = process.argv.slice(2);
const runProduction = args.includes('--production');
const runLocal = args.includes('--local');
const withSession = args.includes('--with-session');
const staticOnly = args.includes('--static-only');
const requireCleanStatic = args.includes('--require-clean-static');

let failures = 0;

function fail(msg) {
  console.error('  FAIL:', msg);
  failures += 1;
}

function ok(msg) {
  console.log('  OK:', msg);
}

function warn(msg) {
  console.log('  WARN:', msg);
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

async function fetchJson(base, endpoint, cookieHeader) {
  const headers = {};
  if (cookieHeader) headers.Cookie = cookieHeader;
  const res = await fetch(`${base}${endpoint.path}`, {
    headers,
    redirect: 'manual',
  });
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body, headers: res.headers };
}

async function probeUnauthenticated(base, label) {
  section(`${label} unauthenticated probe (${base})`);
  for (const endpoint of ADMIN_ENDPOINTS) {
    try {
      const { status, body } = await fetchJson(base, endpoint);
      if (endpoint.expectAuth && status === 401) {
        const errMsg = typeof body === 'object' ? body.error || body.message : body;
        if (String(errMsg || '').toLowerCase().includes('auth')) {
          ok(`${endpoint.path} → 401 (auth required)`);
        } else {
          ok(`${endpoint.path} → 401`);
        }
        if (endpoint.expectSessionUnauth && body && body.authenticated === false) {
          ok(`${endpoint.path} reports authenticated: false`);
        }
      } else if (status === 200 && !endpoint.expectAuth) {
        ok(`${endpoint.path} → 200`);
      } else if (status === 200 && label.toLowerCase().includes('local') && !process.env.ADMIN_PORTAL_SECRET) {
        warn(`${endpoint.path} → 200 (dev open mode — ADMIN_PORTAL_SECRET not set)`);
      } else {
        fail(`${endpoint.path} → ${status} (expected 401 without session)`);
      }
    } catch (e) {
      fail(`${endpoint.path}: ${e.message}`);
    }
  }
}

async function obtainAdminSessionCookie(base) {
  const secret = process.env.ADMIN_PORTAL_SECRET;
  if (!secret) {
    warn('ADMIN_PORTAL_SECRET not set — skipping authenticated local probe');
    return null;
  }
  const res = await fetch(`${base}/api/admin/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/admin_session=([^;]+)/);
  if (!res.ok || !match) {
    const body = await res.text();
    fail(`POST /api/admin/session failed (${res.status}): ${body.slice(0, 120)}`);
    return null;
  }
  ok('Obtained admin_session via break-glass secret');
  return `admin_session=${match[1]}`;
}

async function probeAuthenticated(base, cookieHeader) {
  section(`Authenticated probe (${base})`);
  const dataEndpoints = ADMIN_ENDPOINTS.filter((e) => e.path !== '/api/admin/session');
  for (const endpoint of dataEndpoints) {
    try {
      const { status, body } = await fetchJson(base, endpoint, cookieHeader);
      if (status === 200) {
        ok(`${endpoint.path} → 200`);
      } else {
        fail(`${endpoint.path} → ${status} with session cookie`);
      }
    } catch (e) {
      fail(`${endpoint.path}: ${e.message}`);
    }
  }
  try {
    const { status, body } = await fetchJson(
      base,
      { path: '/api/admin/session' },
      cookieHeader
    );
    if (status === 200 && body && body.authenticated === true) {
      ok('/api/admin/session → authenticated: true');
    } else {
      fail(`/api/admin/session → ${status} (expected authenticated: true)`);
    }
  } catch (e) {
    fail(`/api/admin/session: ${e.message}`);
  }
}

function checkStaticContracts() {
  section('Frontend static contract checks');

  const adminShellPath = path.join(ROOT, 'unified-dashboard/admin/assets/js/admin-shell.js');
  const loginSomoPath = path.join(ROOT, 'unified-dashboard/assets/js/login-somo.js');
  const indexPath = path.join(ROOT, 'unified-dashboard/admin/index.html');

  const adminShell = fs.readFileSync(adminShellPath, 'utf8');
  const loginSomo = fs.readFileSync(loginSomoPath, 'utf8');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  if (adminShell.includes("loginUrl = onAdmin ? '/login.html'") || adminShell.includes('loginUrl = onAdmin\n        ? `${origin}/login.html`') || adminShell.includes('loginUrl = onAdmin\n        ? `${origin}/login.html`')) {
    ok('admin-shell.js uses same-origin login for admin 401 redirect');
  } else if (adminShell.includes('loginUrl = onAdmin') && adminShell.includes('/login.html')) {
    ok('admin-shell.js uses same-origin /login.html for admin 401 redirect');
  } else {
    fail('admin-shell.js missing same-origin admin login redirect');
  }

  if (/const loginUrl = API \? `\$\{API\}\/login\.html`/.test(adminShell) && !adminShell.includes('onAdmin')) {
    fail('admin-shell.js redirects all 401s to API login — admin must stay on callsomo.com');
  } else if (/const loginUrl = API \? `\$\{API\}\/login\.html`/.test(adminShell)) {
    ok('admin-shell.js only uses API login URL for non-admin pages');
  }

  if (adminShell.includes('admin=1')) {
    ok('admin-shell.js appends admin=1 to login redirect');
  } else {
    fail('admin-shell.js missing admin=1 query param on redirect');
  }

  if (loginSomo.includes('isAdminLogin') && loginSomo.includes('/api/admin/session')) {
    ok('login-somo.js has operator admin login flow');
  } else {
    fail('login-somo.js missing admin session login');
  }

  if (loginSomo.includes("sessionStorage.removeItem('admin_auth_redirect')")) {
    ok('login-somo.js clears admin_auth_redirect');
  } else {
    fail('login-somo.js does not clear admin_auth_redirect');
  }

  const debugPatterns = [
    { file: 'admin-shell.js', content: adminShell, pattern: '#region agent log' },
    { file: 'admin-shell.js', content: adminShell, pattern: '127.0.0.1:7741' },
    { file: 'index.html', content: indexHtml, pattern: '#region agent log' },
    { file: 'index.html', content: indexHtml, pattern: '127.0.0.1:7741' },
  ];

  for (const { file, content, pattern } of debugPatterns) {
    if (content.includes(pattern)) {
      if (requireCleanStatic) {
        fail(`${file} still contains debug instrumentation: ${pattern}`);
      } else {
        warn(`${file} still contains debug instrumentation: ${pattern} (clean before deploy)`);
      }
    } else {
      ok(`${file} has no "${pattern}"`);
    }
  }
}

async function main() {
  console.log('Admin portal auth diagnostic');

  if (!runProduction && !runLocal && !staticOnly) {
    console.log('No mode selected — running --static-only and --production');
  }

  if (staticOnly || (!runProduction && !runLocal)) {
    checkStaticContracts();
  }

  if (runProduction || (!runLocal && !staticOnly)) {
    await probeUnauthenticated(PRODUCTION_BASE, 'Production');
  }

  if (runLocal) {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    await probeUnauthenticated(LOCAL_BASE, 'Local');
    if (withSession) {
      const cookie = await obtainAdminSessionCookie(LOCAL_BASE);
      if (cookie) {
        await probeAuthenticated(LOCAL_BASE, cookie);
      }
    }
  }

  if (runProduction || runLocal) {
    checkStaticContracts();
  }

  section('Summary');
  if (failures === 0) {
    console.log('All checks passed.');
    process.exit(0);
  } else {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
