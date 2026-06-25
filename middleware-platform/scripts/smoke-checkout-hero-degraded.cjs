#!/usr/bin/env node
/**
 * Static checks + manual smoke steps for checkout degraded catalog UI (items 5–8).
 *
 * Run from repo root or middleware-platform:
 *   node middleware-platform/scripts/smoke-checkout-hero-degraded.cjs
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const checkout = path.join(root, 'unified-dashboard', 'patients', 'checkout-chat.html');
const landing = path.join(root, 'unified-dashboard', 'littlelab-landing', 'src', 'index.js');

function mustContain(file, label, substrings) {
  const s = fs.readFileSync(file, 'utf8');
  const missing = substrings.filter((x) => !s.includes(x));
  if (missing.length) {
    console.error(`FAIL ${label}: missing ${JSON.stringify(missing)}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`OK ${label}`);
  return true;
}

if (!fs.existsSync(checkout)) {
  console.error('FAIL: checkout-chat.html not found at', checkout);
  process.exit(1);
}

mustContain(checkout, 'checkout degraded hero', [
  'applyCatalogDegradedUI',
  'loadErrRetry',
  'Retry catalog',
  'product_image',
  'STRIP_IMAGE_FALLBACK_BY_ID',
  'resolveDegradedStripImageUrl'
]);

mustContain(landing, 'landing checkout hints', [
  'appendCheckoutQueryHints',
  'checkoutBlockedNoMerchant',
  'REACT_APP_MERCHANT_ID',
  'product_image'
]);

console.log(`
Full manual checklist + screenshot review guidance (items 17–18):
  unified-dashboard/docs/CHECKOUT_LANDING_VERIFICATION.md

--- Quick manual smoke (browser) ---
1. Start API + serve checkout-chat.html (e.g. middleware on :4000).
2. Landing cart icon → checkout: name + image + price path when catalog is up.
3. Catalog blocked/429: hint + Retry, hero not stuck on "Loading…" (URL hints apply).
4. Retry after recovery: catalog loads when API succeeds.
`);
