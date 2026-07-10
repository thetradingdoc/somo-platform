#!/usr/bin/env node
/**
 * Static verification for agentic checkout surfaces (no server required).
 * Patient web checkout (`unified-dashboard/patients/checkout-chat.html`) was retired (G4).
 * This gate asserts retirement + remaining RN checkout analytics contract.
 *
 * Run from repo root: node scripts/verify-agentic-checkout.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fail = (msg) => {
  console.error('verify-agentic-checkout: FAIL —', msg);
  process.exit(1);
};

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

try {
  // G4 — Skin & Care patient portal retired; do not resurrect static checkout HTML.
  if (exists('unified-dashboard/patients/checkout-chat.html')) {
    fail(
      'unified-dashboard/patients/checkout-chat.html must remain retired (G4). Remove it or update patient-portal-retirement.'
    );
  }
  if (exists('unified-dashboard/patients/checkout-chat.js')) {
    fail('unified-dashboard/patients/checkout-chat.js must remain retired (G4).');
  }

  // RN commerce quote surface may still exist for mobile; keep analytics contract.
  if (exists('patient-app/app/checkout-chat.tsx')) {
    const tsx = read('patient-app/app/checkout-chat.tsx');
    if (!tsx.includes('somo_kelly_commerce_quote_v1')) fail('RN missing KELLY_QUOTE_KEY');
    if (!tsx.includes('emitCheckoutAnalytics')) fail('RN missing checkout analytics import/usage');
  }
  if (exists('patient-app/lib/checkoutAnalytics.ts')) {
    const analytics = read('patient-app/lib/checkoutAnalytics.ts');
    if (!analytics.includes('DeviceEventEmitter.emit')) fail('checkoutAnalytics must emit DeviceEventEmitter');
    if (!analytics.includes('checkout-funnel')) fail('checkoutAnalytics must use checkout-funnel event name');
  }

  // Server must keep retirement redirects for /patients/*
  const retirementTest = 'middleware-platform/__tests__/patient-portal-retirement.test.js';
  if (!exists(retirementTest)) {
    fail('missing patient-portal-retirement.test.js (G4 redirect coverage)');
  }
  const retirementSrc = read(retirementTest);
  if (!retirementSrc.includes('/patients/')) {
    fail('patient-portal-retirement.test.js must cover /patients/* redirects');
  }

  console.log('verify-agentic-checkout: OK (patient web checkout retired; RN/analytics contract checked)');
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
