'use strict';

const https = require('https');
const { log } = require('./portal-e2e-config.cjs');

function postSlack(webhookUrl, text) {
  return new Promise((resolve) => {
    if (!webhookUrl) {
      log('alert: no webhook configured — console only');
      console.error(`\n*** PORTAL E2E P0 FAILURE ***\n${text}\n`);
      return resolve(false);
    }
    const body = JSON.stringify({ text });
    const url = new URL(webhookUrl);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        res.resume();
        log(`alert: slack status ${res.statusCode}`);
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', (e) => {
      log(`alert: slack error ${e.message}`);
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

async function alertP0Failure({ config, failed, runEntry }) {
  const webhook =
    process.env.PORTAL_E2E_ALERT_SLACK_WEBHOOK ||
    process.env.PAYMENT_ALERT_SLACK_WEBHOOK ||
    '';
  const text = [
    ':rotating_light: *Portal E2E P0 failure*',
    `env: ${config.pwEnv}`,
    `mode: ${config.pwMode}`,
    `run: ${config.runId}`,
    `actor: ${config.actor}`,
    `failed: ${(failed || []).join(', ') || '(unknown)'}`,
    `sha: ${config.gitSha || 'n/a'}`,
    runEntry?.ts ? `ts: ${runEntry.ts}` : null
  ]
    .filter(Boolean)
    .join('\n');
  return postSlack(webhook, text);
}

module.exports = { alertP0Failure, postSlack };
