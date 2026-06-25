#!/usr/bin/env node
'use strict';

/**
 * Copy canonical brand assets from unified-dashboard/assets/brand/
 * to middleware API static and somo-landing public folders.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SSOT = path.join(ROOT, 'unified-dashboard', 'assets', 'brand');

const TARGETS = [
  path.join(ROOT, 'middleware-platform', 'public', 'assets', 'brand'),
  path.join(ROOT, 'unified-dashboard', 'somo-landing', 'public', 'assets', 'brand'),
];

/** Copied on every sync — product logo, icon, favicons */
const SYNC_FILES = [
  'somo-logo.png',
  'somo-logo-master.png',
  'somo-icon.png',
  'somo-icon-lizard.png',
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'somo-gecko.svg',
  'somo-logo-wordmark.png',
];

/** Not copied to API — deprecated text-only wordmark; do not use in UI */
const SKIP_DEPRECATED = new Set(['somo-logo-wordmark.svg', 'somo-wordmark-text.svg']);

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

if (!fs.existsSync(SSOT)) {
  console.error('SSOT missing:', SSOT);
  process.exit(1);
}

for (const target of TARGETS) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of SYNC_FILES) {
    const src = path.join(SSOT, name);
    if (!fs.existsSync(src)) {
      console.warn('skip (missing):', name);
      continue;
    }
    copyFile(src, path.join(target, name));
    console.log('copied', name, '->', path.relative(ROOT, target));
  }
}

// Optional: copy signup icon SVGs if present
const signupDir = path.join(SSOT, 'signup');
if (fs.existsSync(signupDir)) {
  for (const target of TARGETS) {
    const destSignup = path.join(target, 'signup');
    fs.mkdirSync(destSignup, { recursive: true });
    for (const entry of fs.readdirSync(signupDir)) {
      if (SKIP_DEPRECATED.has(entry)) continue;
      copyFile(path.join(signupDir, entry), path.join(destSignup, entry));
    }
  }
}

console.log('brand:sync complete');
