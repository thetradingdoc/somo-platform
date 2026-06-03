#!/usr/bin/env node
'use strict';

/**
 * Assemble Firebase Hosting bundle for callsomo.com (Firebase somo-4ddf6):
 *   - Somo landing SPA (/)
 *   - Provider signup/login + business portal static HTML
 *   - Unified-dashboard assets at /assets and /unified-dashboard/assets
 *
 * Usage: node scripts/build-staging-hosting.cjs
 * Output: unified-dashboard/hosting-dist/
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const UD = path.join(ROOT, 'unified-dashboard');
const LANDING = path.join(UD, 'somo-landing');
const OUT = path.join(UD, 'hosting-dist');

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest, { merge = false } = {}) {
  if (!fs.existsSync(src)) {
    console.warn(`  skip missing: ${src}`);
    return;
  }
  if (!merge && fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  mkdirp(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d, { merge: true });
    } else if (!fs.existsSync(d)) {
      copyFile(s, d);
    } else if (merge) {
      /* keep existing portal file */
    } else {
      copyFile(s, d);
    }
  }
}

function main() {
  console.log('Building somo-landing…');
  const env = {
    ...process.env,
    VITE_API_BASE: process.env.VITE_API_BASE || 'https://api.callsomo.com',
    VITE_SIGNUP_URL: process.env.VITE_SIGNUP_URL || '/signup?utm_source=somo',
    VITE_LOGIN_URL: process.env.VITE_LOGIN_URL || '/login?utm_source=somo'
  };
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: LANDING,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32'
  });
  if (build.status !== 0) process.exit(build.status || 1);

  console.log('Assembling hosting-dist…');
  rmrf(OUT);
  mkdirp(OUT);

  copyDir(path.join(LANDING, 'build'), OUT);

  console.log('  portal assets → /assets + /unified-dashboard/assets');
  copyDir(path.join(UD, 'assets'), path.join(OUT, 'assets'));
  copyDir(path.join(UD, 'assets'), path.join(OUT, 'unified-dashboard', 'assets'));

  console.log('  landing vite assets (merge)');
  copyDir(path.join(LANDING, 'build', 'assets'), path.join(OUT, 'assets'), { merge: true });

  const landingBrand = path.join(LANDING, 'build', 'assets', 'brand');
  const outBrand = path.join(OUT, 'assets', 'brand');
  if (fs.existsSync(landingBrand)) {
    console.log('  landing brand assets (overwrite portal copies)');
    copyDir(landingBrand, outBrand);
  }

  console.log('  business portal HTML');
  copyDir(path.join(UD, 'business'), path.join(OUT, 'business'));

  const portalPages = ['signup.html', 'login.html', 'signup-complete.html', 'reset-password.html'];
  for (const page of portalPages) {
    const src = path.join(UD, page);
    if (fs.existsSync(src)) copyFile(src, path.join(OUT, page));
  }

  const termsSrc = path.join(ROOT, 'middleware-platform', 'public', 'signup', 'terms.html');
  if (fs.existsSync(termsSrc)) {
    copyFile(termsSrc, path.join(OUT, 'terms.html'));
  }

  const privacySrc = path.join(ROOT, 'middleware-platform', 'public', 'signup', 'privacy.html');
  if (fs.existsSync(privacySrc)) {
    copyFile(privacySrc, path.join(OUT, 'privacy.html'));
  }

  if (fs.existsSync(path.join(UD, 'manifest.webmanifest'))) {
    copyFile(path.join(UD, 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));
  }

  console.log(`\n✅ Staging hosting bundle: ${OUT}`);
  console.log('   Deploy: npm run deploy:staging-hosting');
}

main();
