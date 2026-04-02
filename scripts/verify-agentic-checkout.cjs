#!/usr/bin/env node
/**
 * Static verification for agentic checkout surfaces (no server required).
 * Run from repo root: node scripts/verify-agentic-checkout.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fail = (msg) => {
  console.error('verify-agentic-checkout: FAIL —', msg);
  process.exit(1);
};

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

try {
  const html = read('unified-dashboard/patients/checkout-chat.html');
  const checkoutJs = read('unified-dashboard/patients/checkout-chat.js');
  const tsx = read('patient-app/app/checkout-chat.tsx');
  const analytics = read('patient-app/lib/checkoutAnalytics.ts');

  if (!checkoutJs.includes("emitFunnelEvent('agentic_primary'")) fail('checkout-chat.js missing agentic_primary analytics');
  if (!checkoutJs.includes("emitFunnelEvent('in_chat_pay_tap'")) fail('checkout-chat.js missing in_chat_pay_tap');
  if (!checkoutJs.includes("emitFunnelEvent('manual_checkout_click'")) fail('checkout-chat.js missing manual_checkout_click');
  if (!html.includes("id=\"whyPriceDetails\"")) fail('checkout-chat.html missing why price disclosure');
  if (!html.includes('checkout-chat.js')) fail('checkout-chat.html must link checkout-chat.js');
  if (!html.includes('checkout-phone-e164.js')) fail('checkout-chat.html must link checkout-phone-e164.js');
  if (!tsx.includes('doclittle_kelly_commerce_quote_v1')) fail('RN missing KELLY_QUOTE_KEY');
  if (!tsx.includes('emitCheckoutAnalytics')) fail('RN missing checkout analytics import/usage');
  if (!analytics.includes('DeviceEventEmitter.emit')) fail('checkoutAnalytics must emit DeviceEventEmitter');
  if (!analytics.includes('checkout-funnel')) fail('checkoutAnalytics must use checkout-funnel event name');

  console.log('verify-agentic-checkout: OK (static checks passed)');
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
