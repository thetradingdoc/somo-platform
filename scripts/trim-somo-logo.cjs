#!/usr/bin/env node
'use strict';

/**
 * Trim transparent padding from somo-logo PNGs.
 * For black-background PSD exports, use: node scripts/prepare-somo-logo.cjs <source.png>
 * Run: node scripts/trim-somo-logo.cjs && npm run brand:sync
 */

const fs = require('fs');
const path = require('path');

const sharp = require(path.join(__dirname, '..', 'middleware-platform', 'node_modules', 'sharp'));

const FILES = [
  path.join(__dirname, '..', 'unified-dashboard', 'assets', 'brand', 'somo-logo.png'),
  path.join(__dirname, '..', 'unified-dashboard', 'assets', 'brand', 'somo-logo-master.png'),
];

async function trimFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn('skip missing', filePath);
    return;
  }
  const before = sharp(filePath);
  const meta = await before.metadata();
  const out = await before.trim({ threshold: 10 }).png().toBuffer();
  const after = sharp(out);
  const trimmed = await after.metadata();
  fs.writeFileSync(filePath, out);
  console.log(
    path.basename(filePath),
    `${meta.width}x${meta.height} → ${trimmed.width}x${trimmed.height}`
  );
}

(async () => {
  for (const f of FILES) {
    await trimFile(f);
  }
  console.log('Done. Run: npm run brand:sync');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
