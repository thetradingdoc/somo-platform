#!/usr/bin/env node
'use strict';

/**
 * Phase 7 portal bugs + design system structural gate.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = path.join(ROOT, '..', 'unified-dashboard');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function main() {
  console.log('\n=== Phase 7 Portal Gate ===\n');
  let pass = true;

  const calendar = fs.readFileSync(path.join(UI, 'business/calendar.html'), 'utf8');
  pass = check('calendar list view calls updateSize', calendar.includes('calendar.updateSize()')) && pass;

  const shell = fs.readFileSync(path.join(UI, 'assets/js/provider-shell.js'), 'utf8');
  pass = check('BUG-6 ppFetch with 401', shell.includes('ppFetch') && shell.includes('status === 401')) && pass;
  pass = check('Kelly toggle uses ppFetch', shell.includes("ppFetch || fetch)(`${API_BASE()}/api/kelly/toggle`")) && pass;
  pass = check('Kelly status language refresh', shell.includes('Answering calls')) && pass;
  pass = check('dental empty state helper', shell.includes('ppDentalEmptyState')) && pass;

  const voicePage = fs.readFileSync(path.join(UI, 'assets/js/voice-agent-page.js'), 'utf8');
  pass = check('outbound opener default helper', voicePage.includes('defaultOutboundOpener')) && pass;

  const agent = fs.readFileSync(path.join(UI, 'business/agent.html'), 'utf8');
  pass =
    check(
      'agent outbound via Kelly settings',
      agent.includes('settings.html#kelly') && voicePage.includes('applyOutboundOpenerDefault')
    ) && pass;

  const invoice = fs.readFileSync(path.join(UI, 'business/invoice-detail.html'), 'utf8');
  pass = check('invoice back nav dental-aware', invoice.includes('invoiceBackHref')) && pass;

  const calls = fs.readFileSync(path.join(UI, 'business/calls.html'), 'utf8');
  pass = check('calls dental empty state', calls.includes('ppDentalEmptyState')) && pass;

  console.log('\n' + JSON.stringify({ pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
