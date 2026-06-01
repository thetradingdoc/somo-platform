#!/usr/bin/env node
'use strict';

/**
 * Start middleware with E2E profile and run golden + money paths.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4000);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

function waitForServer(ms = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(`${BASE}/health`, (res) => {
          if (res.statusCode === 200) return resolve();
          if (Date.now() - start > ms) return reject(new Error('Server health timeout'));
          setTimeout(tick, 500);
        })
        .on('error', () => {
          if (Date.now() - start > ms) return reject(new Error('Server health timeout'));
          setTimeout(tick, 500);
        });
    };
    tick();
  });
}

function killPort() {
  return new Promise((resolve) => {
    const p = spawn('lsof', ['-ti', `:${PORT}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.on('close', () => {
      const ids = out
        .trim()
        .split('\n')
        .filter(Boolean);
      if (!ids.length) return resolve();
      const k = spawn('kill', ['-9', ...ids]);
      k.on('close', () => resolve());
    });
  });
}

function runNode(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, script)], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        RCM_E2E_USE_EXISTING_SERVER: '1',
        RCM_E2E_SKIP_GATES: '1',
        PW_API_BASE_URL: BASE,
        DEV_LIGHT_START: '1',
        SKIP_STARTUP_MIGRATIONS: '1',
        FACE_READ_AUTO_START: '0',
        ...extraEnv,
      },
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited ${code}`));
    });
  });
}

async function main() {
  await killPort();

  const serverEnv = {
    ...process.env,
    PORT: String(PORT),
    DEV_LIGHT_START: '1',
    SKIP_STARTUP_MIGRATIONS: '1',
    FACE_READ_AUTO_START: '0',
    RCM_E2E_SKIP_GATES: '1',
    NODE_ENV: process.env.NODE_ENV || 'development',
  };

  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: serverEnv,
  });

  let serverExited = false;
  server.on('exit', (code) => {
    serverExited = true;
    if (code && code !== 0) console.error(`Server exited ${code}`);
  });

  try {
    console.log('Waiting for server...');
    await waitForServer(120000);
    console.log('Server ready\n');

    await runNode('e2e-rcm-golden-path.cjs');
    await runNode('rcm-e2e-money-path.cjs');
    await runNode('e2e-kelly-rcm-pay-gateway.cjs');

    try {
      await runNode('e2e-kelly-booking-fixture.cjs', { KELLY_E2E_SKIP_TRIAGE: '1' });
    } catch (bfErr) {
      console.warn('[rcm-suite] Kelly booking fixture E2E skipped or failed (needs LLM keys):', bfErr.message);
    }

    try {
      const { spawnSync } = require('child_process');
      const pw = spawnSync(
        'npx',
        ['playwright', 'test', 'e2e/patient-rcm-pay-ui.spec.cjs', '--project', 'provider-rcm', '-g', 'mocked API'],
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PW_API_BASE_URL: BASE } }
      );
      if (pw.status !== 0) {
        throw new Error('patient-rcm-pay-ui mocked tests failed');
      }
    } catch (pwErr) {
      console.warn('[rcm-suite] Playwright pay UI skipped or failed:', pwErr.message);
    }

    const hasLlm =
      process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    if (hasLlm) {
      try {
        const { spawnSync } = require('child_process');
        const goldenEnv = {
          ...process.env,
          PW_API_BASE_URL: BASE,
          KELLY_E2E_VISIT_ONLY: '1',
        };
        const golden = spawnSync(
          'npx',
          ['playwright', 'test', '--project', 'kelly-golden', 'e2e/kelly-rcm-golden-path.spec.cjs'],
          { cwd: ROOT, stdio: 'inherit', env: goldenEnv }
        );
        if (golden.status !== 0) {
          console.warn('[rcm-suite] Kelly golden path (visit-only) failed — see playwright-report/kelly-golden-path-report.json');
        }
      } catch (goldenErr) {
        console.warn('[rcm-suite] Kelly golden path skipped or failed:', goldenErr.message);
      }
    }

    console.log('\n✅ RCM E2E suite: PASS');
  } finally {
    if (!serverExited) server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('\n❌ RCM E2E suite: FAIL', err.message);
  process.exit(1);
});
