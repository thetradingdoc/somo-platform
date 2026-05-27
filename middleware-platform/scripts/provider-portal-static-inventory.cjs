#!/usr/bin/env node
'use strict';
/** Static inventory (no server): nav config + onclick handlers in business HTML */

const fs = require('fs');
const path = require('path');

const businessDir = path.join(__dirname, '..', '..', 'unified-dashboard', 'business');

const PORTAL_NAV = [
  { section: 'Workspace' },
  { id: 'today', label: 'Today', href: 'today.html' },
  { id: 'calendar', label: 'Schedule', href: 'calendar.html' },
  { id: 'patients', label: 'Patients', href: 'patients.html' },
  { section: 'Revenue' },
  { id: 'claims', label: 'Claims & RCM', href: 'billing.html?section=overview' },
  { id: 'prior-auth', label: 'Prior Auth', href: 'billing.html?section=claims' },
  { id: 'billing', label: 'Invoices', href: 'billing.html?section=invoices' },
  { section: 'AI Ops' },
  { id: 'agent', label: 'Voice Agent', href: 'agent.html' },
  { id: 'exceptions', label: 'Exceptions', href: 'claims.html' },
  { id: 'profile', label: 'Settings', href: 'settings.html' }
];

const MEDICAL_NAV = [
  { id: 'today', label: 'Today', href: 'today.html' },
  { id: 'calendar', label: 'Schedule', href: 'calendar.html' },
  { id: 'patients', label: 'Patients', href: 'patients.html' },
  { id: 'claims', label: 'Claims & RCM', href: 'billing.html?section=overview' },
  { id: 'billing', label: 'Invoices', href: 'billing.html?section=invoices' },
  { id: 'profile', label: 'Settings', href: 'settings.html' },
  { id: 'wallet', label: 'My Wallet', href: 'wallets.html' },
  { id: 'video', label: 'Video', href: 'video-call.html' }
];

const BILLING_SECTIONS = ['overview', 'scan', 'claims', 'invoices', 'payments', 'commerce'];

const files = fs.readdirSync(businessDir).filter((f) => f.endsWith('.html'));

console.log('\n=== PROVIDER PORTAL STATIC INVENTORY ===\n');
console.log('--- provider-shell.js sidebar (Today page only) ---');
for (const item of PORTAL_NAV) {
  if (item.section) console.log(`  [section] ${item.section}`);
  else console.log(`  [nav] ${item.label} → ${item.href}`);
}

console.log('\n--- config.js MEDICAL_NAV_ITEMS (legacy pages) ---');
for (const item of MEDICAL_NAV) {
  console.log(`  [nav] ${item.label} → ${item.href}`);
}

console.log('\n--- billing.html sections (showSection) ---');
for (const s of BILLING_SECTIONS) console.log(`  [section-tab] ${s}`);

console.log('\n--- Per-page: provider-portal shell + sample controls ---');
for (const file of files.sort()) {
  const html = fs.readFileSync(path.join(businessDir, file), 'utf8');
  const hasShell = html.includes('provider-shell.js');
  const hasPortalCss = html.includes('provider-portal');
  const showSections = [...html.matchAll(/showSection\('([^']+)'\)/g)].map((m) => m[1]);
  const uniqueSections = [...new Set(showSections)];
  const onclickBtns = [...html.matchAll(/onclick="([^"]{1,80})"/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith('showSection'))
    .slice(0, 8);
  console.log(`\n  ${file}`);
  console.log(`    provider-shell: ${hasShell ? 'yes' : 'no'} | provider-portal CSS: ${hasPortalCss ? 'yes' : 'no'}`);
  if (uniqueSections.length) console.log(`    showSection tabs: ${uniqueSections.join(', ')}`);
  if (html.includes('pp-panel-tabs')) console.log('    today-style pp-panel-tabs: yes');
  if (onclickBtns.length) console.log(`    sample onclick: ${onclickBtns.join(' | ')}`);
}

console.log('\nRun live inventory: PW_API_BASE_URL=http://127.0.0.1:4000 node scripts/playwright-provider-portal-inventory.cjs\n');
