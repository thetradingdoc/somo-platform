#!/usr/bin/env node
'use strict';

/**
 * Read live Cloud Run env for Kelly Rails V2 (staging/prod).
 * Requires: gcloud auth and access to the service.
 *
 * Usage:
 *   node scripts/verify-kelly-rails-cloudrun-env.cjs
 *   GCP_SERVICE=somo-middleware GCP_REGION=us-central1 node scripts/verify-kelly-rails-cloudrun-env.cjs
 */

const { spawnSync } = require('child_process');

const SERVICE = process.env.GCP_SERVICE || 'somo-middleware';
const REGION = process.env.GCP_REGION || process.env.GOOGLE_CLOUD_REGION || 'us-central1';
const PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';

function gcloud(args) {
  const base = ['run', 'services', 'describe', SERVICE, '--region', REGION, '--format', 'json'];
  if (PROJECT) base.unshift('--project', PROJECT);
  const r = spawnSync('gcloud', [...base, ...args], { encoding: 'utf8' });
  return r;
}

function envMap(serviceJson) {
  const out = {};
  const containers = serviceJson?.spec?.template?.spec?.containers || [];
  for (const c of containers) {
    for (const e of c.env || []) {
      if (e.name) out[e.name] = e.value ?? `(secret:${e.valueFrom?.secretKeyRef?.name || 'ref'})`;
    }
  }
  return out;
}

function main() {
  const which = spawnSync('which', ['gcloud'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.error('gcloud not found. Manual check:');
    console.error(`  gcloud run services describe ${SERVICE} --region ${REGION} --format=json`);
    console.error('  Confirm: KELLY_RAILS_V2=1, KELLY_ALLOW_HYBRID_GRAPH=0, KELLY_RAILS_ROLLOUT_PCT=1');
    process.exit(2);
  }

  const r = gcloud([]);
  if (r.status !== 0) {
    console.error('gcloud describe failed:', r.stderr || r.stdout);
    console.error('Record manual env snapshot in todos/pending/KELLY_CONVERSATION_RAILS_TODOS.md');
    process.exit(2);
  }

  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    console.error('Failed to parse gcloud JSON:', e.message);
    process.exit(2);
  }

  const env = envMap(json);
  const keys = [
    'KELLY_RAILS_V2',
    'KELLY_ALLOW_HYBRID_GRAPH',
    'KELLY_RAILS_ROLLOUT_PCT',
    'CONVERSATION_MODE_ROUTING'
  ];
  const snapshot = {};
  for (const k of keys) snapshot[k] = env[k] ?? '(unset)';

  console.log(JSON.stringify({ service: SERVICE, region: REGION, revision: json.status?.latestReadyRevisionName, env: snapshot }, null, 2));

  const errors = [];
  if (String(env.KELLY_RAILS_V2 || '') !== '1') errors.push('KELLY_RAILS_V2 must be 1');
  const hybrid = String(env.KELLY_ALLOW_HYBRID_GRAPH || '0').toLowerCase();
  if (hybrid === '1' || hybrid === 'true') errors.push('KELLY_ALLOW_HYBRID_GRAPH must be 0 or unset');
  const pct = env.KELLY_RAILS_ROLLOUT_PCT;
  if (pct != null && pct !== '' && parseFloat(pct) < 1) errors.push('KELLY_RAILS_ROLLOUT_PCT must be 1');
  if (String(env.CONVERSATION_MODE_ROUTING || 'shadow').toLowerCase() !== 'enforce') {
    errors.push('CONVERSATION_MODE_ROUTING must be enforce');
  }

  if (errors.length) {
    console.error('Cloud Run Kelly env FAILED:', errors.join('; '));
    process.exit(1);
  }
  console.log('Cloud Run Kelly env OK');
}

main();
