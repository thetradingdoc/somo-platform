#!/usr/bin/env node
'use strict';

/**
 * Live Cloud Run env for pilot prod readiness (Kelly + PILOT_* + Slack + encryption secret).
 *
 * Usage:
 *   node scripts/verify-cloudrun-pilot-prod.cjs
 *   STRICT=1 node scripts/verify-cloudrun-pilot-prod.cjs
 */

const { spawnSync } = require('child_process');

const SERVICE = process.env.GCP_SERVICE || process.env.CLOUDRUN_SERVICE || 'somo-middleware';
const REGION = process.env.GCP_REGION || process.env.GOOGLE_CLOUD_REGION || 'us-central1';
const PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function gcloudDescribe() {
  const base = ['run', 'services', 'describe', SERVICE, '--region', REGION, '--format', 'json'];
  if (PROJECT) base.unshift('--project', PROJECT);
  return spawnSync('gcloud', base, { encoding: 'utf8' });
}

function envMap(serviceJson) {
  const out = {};
  const containers = serviceJson?.spec?.template?.spec?.containers || [];
  for (const c of containers) {
    for (const e of c.env || []) {
      if (!e.name) continue;
      if (e.value != null) out[e.name] = e.value;
      else if (e.valueFrom?.secretKeyRef?.name) {
        out[e.name] = `(secret:${e.valueFrom.secretKeyRef.name})`;
      }
    }
  }
  return out;
}

function check(errors, name, ok, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) errors.push(name);
}

function main() {
  const strict = truthy(process.env.STRICT) || truthy(process.env.PILOT_PROD_STRICT);
  console.log('\n=== Cloud Run pilot prod env ===\n');

  const which = spawnSync('which', ['gcloud'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.error('gcloud not found — skip live verify');
    process.exit(strict ? 2 : 0);
  }

  const r = gcloudDescribe();
  if (r.status !== 0) {
    console.error('gcloud describe failed:', r.stderr || r.stdout);
    process.exit(strict ? 2 : 0);
  }

  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    console.error('parse failed:', e.message);
    process.exit(strict ? 2 : 0);
  }

  const env = envMap(json);
  const errors = [];

  check(errors, 'KELLY_RAILS_V2=1', String(env.KELLY_RAILS_V2 || '') === '1', env.KELLY_RAILS_V2 || '(unset)');
  check(
    errors,
    'CONVERSATION_MODE_ROUTING=enforce',
    String(env.CONVERSATION_MODE_ROUTING || '').toLowerCase() === 'enforce',
    env.CONVERSATION_MODE_ROUTING || '(unset)'
  );
  check(errors, 'PILOT_INVITE_ONLY=1', truthy(env.PILOT_INVITE_ONLY), env.PILOT_INVITE_ONLY || '(unset)');
  check(
    errors,
    'PILOT_RATE_LIMIT_ENABLED=1',
    truthy(env.PILOT_RATE_LIMIT_ENABLED),
    env.PILOT_RATE_LIMIT_ENABLED || '(unset)'
  );

  const eligSlack = (env.ELIGIBILITY_ALERT_SLACK_WEBHOOK || '').trim();
  const paySlack = (env.PAYMENT_ALERT_SLACK_WEBHOOK || '').trim();
  check(
    errors,
    'ELIGIBILITY_ALERT_SLACK_WEBHOOK',
    strict ? Boolean(eligSlack) : true,
    eligSlack ? 'configured' : 'unset'
  );
  check(
    errors,
    'PAYMENT_ALERT_SLACK_WEBHOOK',
    strict ? Boolean(paySlack) : true,
    paySlack ? 'configured' : 'unset'
  );

  const enc = env.API_KEY_ENCRYPTION_KEY || '';
  const encOk = enc.startsWith('(secret:') || Boolean(enc.trim());
  check(
    errors,
    'API_KEY_ENCRYPTION_KEY',
    strict ? encOk : true,
    encOk ? enc.slice(0, 40) : 'missing'
  );

  const stediTest = String(env.STEDI_TEST_MODE || '').trim();
  check(
    errors,
    'STEDI_TEST_MODE=0 (when prod Stedi enrolled)',
    !strict || stediTest === '0' || stediTest === '',
    `current=${stediTest || '(unset)'}`
  );

  console.log(`\nrevision: ${json.status?.latestReadyRevisionName || 'unknown'}`);
  if (errors.length && strict) {
    console.error('\nCloud Run pilot prod FAILED:', errors.join(', '));
    process.exit(1);
  }
  console.log('\nCloud Run pilot prod OK\n');
}

main();
