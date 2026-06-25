#!/usr/bin/env node
'use strict';

/**
 * Prepare title-case Somo wordmark PNG for SSOT (solid black on transparent).
 *
 * Usage: node scripts/prepare-somo-logo.cjs <source.png>
 * Then: npm run brand:sync
 */

const fs = require('fs');
const path = require('path');

const sharp = require(path.join(__dirname, '..', 'middleware-platform', 'node_modules', 'sharp'));
const { extractFromRaw } = require('./brand-image-extract.cjs');

const BRAND = path.join(__dirname, '..', 'unified-dashboard', 'assets', 'brand');
const src = process.argv[2];

if (!src || !fs.existsSync(src)) {
  console.error('Usage: node scripts/prepare-somo-logo.cjs <source.png>');
  process.exit(1);
}

async function extractLogo(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { buffer, mode } = extractFromRaw(data, info);
  const png = await sharp(buffer, { raw: info })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();
  return { png, mode };
}

(async () => {
  const { png, mode } = await extractLogo(src);
  const logo = path.join(BRAND, 'somo-logo.png');
  const master = path.join(BRAND, 'somo-logo-master.png');
  fs.writeFileSync(logo, png);
  fs.writeFileSync(master, png);
  const meta = await sharp(png).metadata();
  console.log(`Wrote ${logo} ${meta.width}x${meta.height} (mode: ${mode})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
