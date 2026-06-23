#!/usr/bin/env node
'use strict';

/**
 * Staging deploy + live-call readiness checklist.
 * Usage:
 *   node scripts/verify/verify-staging-coding-deploy.cjs
 *   CODING_STAGING_URL=https://... node scripts/verify/verify-ops-live-call-readiness.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { REQUIRED_ENV, FORBIDDEN_ENV, fetchHealth } = require('../lib/deploy-readiness.cjs');

const mp = path.join(__dirname, '..');

const REQUIRED_SCRIPTS = [
  'scripts/verify/verify-live-call.cjs',
  'scripts/verify/verify-kelly-http-collect.cjs',
  'scripts/harness/capture-coding-prod-evidence.cjs',
  'scripts/generate-cloudrun-env-yaml.cjs',
  'scripts/verify/verify-tenant-site-context.cjs'
];

async function main() {
  const checks = [];

  for (const rel of REQUIRED_SCRIPTS) {
    const full = path.join(mp, rel);
    checks.push({
      name: `script_${rel.replace(/\//g, '_')}`,
      pass: fs.existsSync(full),
      path: rel
    });
  }

  checks.push({
    name: 'voice_spine_doc',
    pass: fs.existsSync(path.join(mp, '..', 'docs', 'Medical Coding', 'VOICE_CODING_SPINE.md')),
    path: 'docs/Medical Coding/VOICE_CODING_SPINE.md'
  });

  try {
    execSync('node scripts/verify/verify-staging-coding-deploy.cjs', { cwd: mp, stdio: 'pipe' });
    checks.push({ name: 'staging_env_checklist', pass: true });
  } catch (e) {
    checks.push({ name: 'staging_env_checklist', pass: false, error: e.message });
  }

  if (process.env.DB_PATH || process.env.GCS_DB_BUCKET) {
    try {
      execSync('node scripts/verify/verify-tenant-site-context.cjs --json', {
        cwd: mp,
        stdio: 'pipe',
        env: { ...process.env }
      });
      checks.push({ name: 'tenant_site_context', pass: true });
    } catch (e) {
      checks.push({
        name: 'tenant_site_context',
        pass: false,
        error: (e.stdout || e.stderr || e.message || '').toString().slice(0, 500)
      });
    }
  } else {
    checks.push({
      name: 'tenant_site_context',
      pass: true,
      skipped: true,
      note: 'Set DB_PATH or GCS_DB_BUCKET to verify tenant DID bind'
    });
  }

  const stagingUrl = process.env.CODING_STAGING_URL || process.env.STAGING_API_URL;
  if (stagingUrl) {
    try {
      const health = await fetchHealth(stagingUrl);
      checks.push({ name: 'staging_health', pass: health.ok, ...health });
    } catch (e) {
      checks.push({ name: 'staging_health', pass: false, error: e.message, url: stagingUrl });
    }
  } else {
    checks.push({
      name: 'staging_health',
      pass: true,
      skipped: true,
      note: 'Set CODING_STAGING_URL to probe /health after deploy'
    });
  }

  checks.push({
    name: 'live_call_command',
    pass: true,
    command: 'DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-live-call.cjs --session_id=<SESSION_ID>'
  });

  const failed = checks.filter((c) => c.pass === false);
  console.log(JSON.stringify({
    success: failed.length === 0,
    required_env: REQUIRED_ENV,
    forbidden_env: FORBIDDEN_ENV,
    checks,
    note: 'Real call proof: run verify-live-call.cjs after a Retell session; exit 0 required for production DoD.'
  }, null, 2));
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
