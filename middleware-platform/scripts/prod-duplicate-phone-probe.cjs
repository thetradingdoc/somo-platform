#!/usr/bin/env node
'use strict';

/**
 * Retired — somo-demo/request-call API removed (June 2026).
 * Exits 0 with skip message so CI does not probe a dead endpoint.
 */
console.log(JSON.stringify({
  run_at: new Date().toISOString(),
  skipped: true,
  reason: 'somo-demo/request-call retired — use platform inbound +363 or admin CRM outbound',
  pass: true
}, null, 2));
process.exit(0);
