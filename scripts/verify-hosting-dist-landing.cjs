#!/usr/bin/env node
'use strict';

/**
 * Verify Somo landing hosting bundle (or live site) has UI parity artifacts.
 *
 * Usage:
 *   node scripts/verify-hosting-dist-landing.cjs
 *   node scripts/verify-hosting-dist-landing.cjs --live https://callsomo.com
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOSTING_DIST = path.join(ROOT, 'unified-dashboard', 'hosting-dist');
const LIVE_ARG = process.argv.find((a) => a.startsWith('--live'));
const LIVE_BASE = LIVE_ARG ? process.argv[process.argv.indexOf(LIVE_ARG) + 1] : null;

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function findLandingCss(dir) {
  const assetsDir = path.join(dir, 'assets');
  if (!fs.existsSync(assetsDir)) return null;
  const css = fs.readdirSync(assetsDir).filter((f) => /^index-.*\.css$/i.test(f));
  return css.length ? path.join(assetsDir, css[0]) : null;
}

function cssHasLogoFix(cssText) {
  if (/clip-path:\s*inset\(33%/i.test(cssText)) {
    return false;
  }
  const hasContain =
    /\.somo-logo-img[^}]*object-fit:\s*contain/i.test(cssText) ||
    /\.somo-logo-img\{[^}]*object-fit:contain/i.test(cssText);
  const hasNavHeight =
    /\.somo-logo-img[^}]*var\(--somo-nav-logo-size\)/i.test(cssText) ||
    /\.somo-logo-img\{[^}]*var\(--somo-nav-logo-size\)/i.test(cssText);
  return hasContain && hasNavHeight;
}

async function verifyLocalDist() {
  const hero = path.join(HOSTING_DIST, 'assets', 'brand', 'hero-phone-v2.jpg');
  if (!fs.existsSync(hero)) {
    fail(`Missing ${hero}. Run: node scripts/build-staging-hosting.cjs`);
  }
  ok(`hero-phone-v2.jpg present in hosting-dist`);

  const logo = path.join(HOSTING_DIST, 'assets', 'brand', 'somo-logo.png');
  if (!fs.existsSync(logo)) {
    fail(`Missing ${logo}`);
  }
  ok(`somo-logo.png present in hosting-dist`);

  const cssPath = findLandingCss(HOSTING_DIST);
  if (!cssPath) {
    fail('No index-*.css in hosting-dist/assets');
  }
  const cssText = fs.readFileSync(cssPath, 'utf8');
  if (!cssHasLogoFix(cssText)) {
    fail(
      `Logo CSS fix not found in ${path.basename(cssPath)} (expected object-fit:contain + height:var(--somo-nav-logo-size) on .somo-logo-img, no clip-path crop)`
    );
  }
  ok(`Logo CSS fix present in ${path.basename(cssPath)}`);
}

async function verifyLive(base) {
  const origin = String(base || '').replace(/\/$/, '');
  if (!origin) fail('--live requires a URL');

  const heroRes = await fetch(`${origin}/assets/brand/hero-phone-v2.jpg`, { method: 'HEAD' });
  if (!heroRes.ok) {
    fail(`Live hero asset ${heroRes.status} ${origin}/assets/brand/hero-phone-v2.jpg`);
  }
  ok(`Live hero asset 200`);

  const indexRes = await fetch(`${origin}/`);
  if (!indexRes.ok) fail(`Live index ${indexRes.status}`);
  const html = await indexRes.text();
  const cssMatch = html.match(/assets\/(index-[^"]+\.css)/);
  if (!cssMatch) fail('Could not find index-*.css in live index.html');
  const cssUrl = `${origin}/assets/${cssMatch[1]}`;
  const cssRes = await fetch(cssUrl);
  if (!cssRes.ok) fail(`Live CSS ${cssRes.status} ${cssUrl}`);
  const cssText = await cssRes.text();
  if (!cssHasLogoFix(cssText)) {
    fail(`Live CSS missing logo fix (${cssMatch[1]}). Hard-refresh or redeploy hosting.`);
  }
  ok(`Live logo CSS fix in ${cssMatch[1]}`);
}

async function main() {
  if (LIVE_BASE) {
    await verifyLive(LIVE_BASE);
  } else {
    if (!fs.existsSync(HOSTING_DIST)) {
      fail(`Missing ${HOSTING_DIST}. Run: node scripts/build-staging-hosting.cjs`);
    }
    await verifyLocalDist();
  }
  console.log('\n✅ Hosting landing verification passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
