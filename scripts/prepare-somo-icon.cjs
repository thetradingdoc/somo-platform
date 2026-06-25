#!/usr/bin/env node
'use strict';

/**
 * Prepare somo-icon.png from a dedicated icon source (square mark).
 *
 * Usage: node scripts/prepare-somo-icon.cjs <source.png>
 * Then: npm run brand:favicons && npm run brand:sync
 */

const fs = require('fs');
const path = require('path');

const sharp = require(path.join(__dirname, '..', 'middleware-platform', 'node_modules', 'sharp'));
const { extractFromRaw } = require('./brand-image-extract.cjs');

const BRAND = path.join(__dirname, '..', 'unified-dashboard', 'assets', 'brand');
const src = process.argv[2];

if (!src || !fs.existsSync(src)) {
  console.error('Usage: node scripts/prepare-somo-icon.cjs <source.png>');
  process.exit(1);
}

(async () => {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { buffer, mode } = extractFromRaw(data, info);

  const trimmed = await sharp(buffer, { raw: info })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();

  const out = await sharp(trimmed)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const dest = path.join(BRAND, 'somo-icon.png');
  fs.writeFileSync(dest, out);
  const meta = await sharp(out).metadata();
  console.log(`Wrote ${dest} ${meta.width}x${meta.height} (mode: ${mode})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
