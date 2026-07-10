'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { log } = require('./portal-e2e-config.cjs');

const MP = path.join(__dirname, '..', '..');

function runScript(script, env = {}) {
  const full = path.join(MP, 'scripts', script);
  log(`gate: running ${script}`);
  try {
    const out = execSync(`node "${full}"`, {
      cwd: MP,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (out.trim()) console.log(out.trim());
    return { ok: true, output: out };
  } catch (err) {
    const msg = (err.stdout || '') + (err.stderr || '') + (err.message || '');
    console.error(msg.trim());
    return { ok: false, output: msg, code: err.status };
  }
}

async function runDeployShaGate({ isProd }) {
  if (!isProd) {
    log('gate: deploy SHA skipped (not production)');
    return { ok: true, skipped: true };
  }
  return runScript('verify-env-gates.cjs', { CLOUDRUN_VERIFY: '1' });
}

async function runStripeGate({ isProd }) {
  if (!isProd) {
    log('gate: stripe preflight skipped (not production)');
    return { ok: true, skipped: true };
  }
  return runScript('verify-stripe-billing-mode.cjs', {});
}

async function runAllGates(config) {
  log('gate: === pre-flight gates ===');
  const deploy = await runDeployShaGate(config);
  const stripe = await runStripeGate(config);
  const ok = deploy.ok && stripe.ok;
  log(`gate: ${ok ? 'PASS' : 'FAIL'} deploy=${deploy.ok} stripe=${stripe.ok}`);
  return { ok, deploy, stripe };
}

module.exports = { runAllGates, runDeployShaGate, runStripeGate };
