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
  { id: 'revenue', label: 'Revenue', href: 'revenue.html' },
  { section: 'AI Ops' },
  { id: 'agent', label: 'Voice Agent', href: 'agent.html' },
  { id: 'profile', label: 'Settings', href: 'settings.html' }
];

const BILLING_SECTIONS = ['overview', 'scan', 'claims', 'remittance', 'prior-auth', 'invoices'];

const files = fs.readdirSync(businessDir).filter((f) => f.endsWith('.html'));

console.log('\n=== PROVIDER PORTAL STATIC INVENTORY ===\n');
console.log('--- provider-shell.js PORTAL_NAV_BASE ---');
for (const item of PORTAL_NAV) {
  if (item.section) console.log(`  [section] ${item.section}`);
  else console.log(`  [nav] ${item.label} → ${item.href}`);
}

console.log('\n--- billing.html sections (showSection) ---');
for (const s of BILLING_SECTIONS) console.log(`  [section-tab] ${s}`);

console.log('\n--- Per-page: provider-portal shell + sample controls ---');
for (const file of files.sort()) {
  const html = fs.readFileSync(path.join(businessDir, file), 'utf8');
  const hasShell = html.includes('provider-shell.js');
  const hasChrome = html.includes('provider-shell-chrome.js');
  const hasPortalCss = html.includes('provider-portal');
  const hasLegacyRedirect = html.includes('legacy-provider-redirect');
  const showSections = [...html.matchAll(/showSection\('([^']+)'\)/g)].map((m) => m[1]);
  const uniqueSections = [...new Set(showSections)];
  console.log(`\n  ${file}`);
  console.log(`    provider-shell: ${hasShell ? 'yes' : 'no'} | chrome: ${hasChrome ? 'yes' : 'no'} | legacy-redirect: ${hasLegacyRedirect ? 'yes' : 'no'}`);
  if (uniqueSections.length) console.log(`    showSection tabs: ${uniqueSections.join(', ')}`);
  if (html.includes('ppKellyLive')) console.log('    kelly widget in HTML: yes');
}

console.log('\nRun live inventory: PW_API_BASE_URL=http://127.0.0.1:4000 node scripts/playwright-provider-portal-inventory.cjs\n');
