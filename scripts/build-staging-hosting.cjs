#!/usr/bin/env node
'use strict';

/**
 * Assemble Firebase Hosting bundle for callsomo.com (Firebase somo-4ddf6):
 *   - Root redirect to business trial activation
 *   - Provider signup/login + business portal static HTML
 *   - Unified-dashboard assets at /assets and /unified-dashboard/assets
 *
 * Usage: node scripts/build-staging-hosting.cjs
 * Output: unified-dashboard/hosting-dist/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const UD = path.join(ROOT, 'unified-dashboard');
const OUT = path.join(UD, 'hosting-dist');
const REDIRECT_TARGET = '/business/trial-activation.html';

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

function writeRootRedirectIndex() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=${REDIRECT_TARGET}">
  <title>Somo</title>
  <script>location.replace('${REDIRECT_TARGET}');</script>
</head>
<body>
  <p><a href="${REDIRECT_TARGET}">Continue to Somo</a></p>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
}

function main() {
  console.log('Assembling hosting-dist…');
  rmrf(OUT);
  mkdirp(OUT);

  console.log('  health-video SPA build');
  const healthUiDir = path.join(UD, 'health-video-landing');
  if (fs.existsSync(path.join(healthUiDir, 'package.json'))) {
    execSync('npm ci', { cwd: healthUiDir, stdio: 'inherit' });
    execSync('npm run health:ui:build', { cwd: ROOT, stdio: 'inherit' });
  }

  writeRootRedirectIndex();

  console.log('  portal assets → /assets + /unified-dashboard/assets');
  copyDir(path.join(UD, 'assets'), path.join(OUT, 'assets'));
  copyDir(path.join(UD, 'assets'), path.join(OUT, 'unified-dashboard', 'assets'));

  console.log('  business portal HTML');
  copyDir(path.join(UD, 'business'), path.join(OUT, 'business'));

  const healthVideoDist = path.join(UD, 'health-video-landing', 'dist');
  if (fs.existsSync(path.join(healthVideoDist, 'index.html'))) {
    console.log('  health-video SPA → /health-video');
    copyDir(healthVideoDist, path.join(OUT, 'health-video'));
  }

  console.log('  admin portal HTML');
  copyDir(path.join(UD, 'admin'), path.join(OUT, 'admin'));

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
