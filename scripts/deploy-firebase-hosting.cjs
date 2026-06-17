#!/usr/bin/env node
'use strict';

/**
 * Build hosting-dist and deploy to Firebase Hosting (callsomo.com).
 *
 * Auth (pick one):
 *   firebase login --reauth
 *   export FIREBASE_TOKEN=$(firebase login:ci)   # headless / CI
 *
 * Usage:
 *   node scripts/deploy-firebase-hosting.cjs
 *   FIREBASE_HOSTING_PROJECT=somo-4ddf6 node scripts/deploy-firebase-hosting.cjs --skip-build
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UD = path.join(ROOT, 'unified-dashboard');
const PROJECT = process.env.FIREBASE_HOSTING_PROJECT || 'somo-4ddf6';
const SITE = process.env.FIREBASE_HOSTING_SITE || PROJECT;
const skipBuild = process.argv.includes('--skip-build');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env }
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function firebaseBin() {
  return path.join(ROOT, 'node_modules', '.bin', 'firebase');
}

function ensureFirebaseAuth() {
  if (process.env.FIREBASE_TOKEN) {
    console.log('Using FIREBASE_TOKEN for deploy auth.');
    return;
  }

  const check = spawnSync(firebaseBin(), ['projects:list', '--project', PROJECT], {
    cwd: UD,
    encoding: 'utf8'
  });

  if (check.status === 0) {
    return;
  }

  const out = `${check.stdout || ''}${check.stderr || ''}`;
  if (/credentials are no longer valid|Authentication Error|Failed to list Firebase projects/i.test(out)) {
    console.error('\n❌ Firebase credentials expired or missing.\n');
    console.error('Run in your terminal (opens browser):');
    console.error('  cd unified-dashboard && npx firebase-tools login --reauth\n');
    console.error('Or for CI / headless:');
    console.error('  export FIREBASE_TOKEN=$(npx firebase-tools login:ci)\n');
    process.exit(1);
  }

  console.error(out.trim() || 'Firebase auth check failed.');
  process.exit(check.status ?? 1);
}

if (!skipBuild) {
  run(process.execPath, [path.join(__dirname, 'build-staging-hosting.cjs')]);
  run(process.execPath, [path.join(__dirname, 'verify-staging-hosting.cjs')]);
}

ensureFirebaseAuth();

console.log(`\n==> Deploying hosting site ${SITE} (project ${PROJECT})…\n`);
run(firebaseBin(), [
  'deploy',
  '--only',
  `hosting:${SITE}`,
  '--project',
  PROJECT
], { cwd: UD });

console.log('\n✅ Firebase hosting deploy complete.');
console.log('   Verify: https://callsomo.com/admin');
