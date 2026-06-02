#!/usr/bin/env node
'use strict';

/**
 * Regenerate favicon PNGs from unified-dashboard/assets/brand/somo-icon.png.
 * Requires macOS `sips` or ImageMagick `magick`/`convert`.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BRAND = path.join(__dirname, '..', 'unified-dashboard', 'assets', 'brand');
const ICON = path.join(BRAND, 'somo-icon.png');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function has(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!fs.existsSync(ICON)) {
  console.error('Missing', ICON);
  process.exit(1);
}

if (!has('sips')) {
  console.error('sips not found (macOS). Install ImageMagick or run on macOS.');
  process.exit(1);
}

const sizes = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
];

for (const [name, px] of sizes) {
  const out = path.join(BRAND, name);
  run(`sips -z ${px} ${px} "${ICON}" --out "${out}"`);
}

const fav32 = path.join(BRAND, 'favicon-32x32.png');
const favIco = path.join(BRAND, 'favicon.ico');
if (has('magick')) {
  run(`magick "${fav32}" "${favIco}"`);
} else if (has('convert')) {
  run(`convert "${fav32}" "${favIco}"`);
} else {
  fs.copyFileSync(fav32, favIco);
  console.warn('ImageMagick not found; favicon.ico is a 32x32 PNG copy');
}

console.log('Brand favicons updated in', BRAND);
