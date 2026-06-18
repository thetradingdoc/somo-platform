#!/usr/bin/env node
'use strict';

/**
 * Production env gate — fail unsafe Kelly routing in production profile.
 *
 * Fails when CLOUDRUN_PROFILE=production and:
 *   - CONVERSATION_MODE_ROUTING=shadow, OR
 *   - KELLY_ALLOW_HYBRID_GRAPH=1
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function main() {
  const profile = String(process.env.CLOUDRUN_PROFILE || '').trim().toLowerCase();
  const isProd = profile === 'production' || profile === 'prod';
  const modeRouting = String(process.env.CONVERSATION_MODE_ROUTING || '').trim().toLowerCase();
  const hybrid = process.env.KELLY_ALLOW_HYBRID_GRAPH;

  const report = {
    cloudrun_profile: profile || null,
    conversation_mode_routing: modeRouting || null,
    kelly_allow_hybrid_graph: hybrid ?? null,
    production_profile: isProd,
    violations: []
  };

  if (isProd) {
    if (modeRouting === 'shadow') {
      report.violations.push('CONVERSATION_MODE_ROUTING=shadow is not allowed in production');
    }
    if (truthy(hybrid)) {
      report.violations.push('KELLY_ALLOW_HYBRID_GRAPH=1 is not allowed in production');
    }
  }

  report.pass = report.violations.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
