#!/usr/bin/env node
'use strict';

/**
 * Copy logo/icon PNGs into brand SSOT without any image processing.
 * Use this when designer files are already correct (transparent PNG).
 *
 * Usage:
 *   node scripts/brand-copy-assets.cjs <logo.png> [icon.png]
 *   npm run brand:sync
 */

const fs = require('fs');
const path = require('path');

const BRAND = path.join(__dirname, '..', 'unified-dashboard', 'assets', 'brand');
const logoSrc = process.argv[2];
const iconSrc = process.argv[3];

if (!logoSrc || !fs.existsSync(logoSrc)) {
  console.error('Usage: node scripts/brand-copy-assets.cjs <logo.png> [icon.png]');
  process.exit(1);
}

function copy(src, dest) {
  fs.copyFileSync(src, dest);
  console.log('copied', path.basename(src), '->', path.relative(process.cwd(), dest));
}

copy(logoSrc, path.join(BRAND, 'somo-logo.png'));
copy(logoSrc, path.join(BRAND, 'somo-logo-master.png'));
copy(logoSrc, path.join(BRAND, 'somo-logo-source.png'));

if (iconSrc && fs.existsSync(iconSrc)) {
  copy(iconSrc, path.join(BRAND, 'somo-icon.png'));
  copy(iconSrc, path.join(BRAND, 'somo-icon-source.png'));
}

console.log('Done. Run: npm run brand:favicons && npm run brand:sync');
